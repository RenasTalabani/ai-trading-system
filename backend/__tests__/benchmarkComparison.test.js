/**
 * getBenchmarkComparison() -- master-plan decision #22's graduation
 * criterion, part 2 ("outperforming a buy-and-hold BTC benchmark"). This
 * function only ever reports the two facts (elapsed time, benchmark
 * comparison) -- it never decides "go live now" on its own; see its own
 * comment for why. All Mongoose models are monkey-patched with in-memory
 * fakes -- this suite never opens a real database connection.
 */
jest.mock('../src/services/riskStateService', () => ({
  getState: jest.fn(async () => ({ dailyLossHalted: false })),
  isHalted: jest.fn(async () => false),
}));
jest.mock('../src/services/binanceService', () => ({
  getCachedPrice: jest.fn(),
}));
jest.mock('../src/models/VirtualPortfolio', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock('../src/models/MarketData', () => ({
  findOne: jest.fn(),
}));
jest.mock('../src/models/Signal', () => ({}));
jest.mock('../src/models/VirtualTrade', () => ({}));
jest.mock('../src/models/BudgetSession', () => ({}));

const VirtualPortfolio = require('../src/models/VirtualPortfolio');
const MarketData       = require('../src/models/MarketData');
const binanceService   = require('../src/services/binanceService');
const { getBenchmarkComparison } = require('../src/services/virtualTrackingService');

let FAKE_CANDLES;

function makeQuery(filtered) {
  return {
    sort: (sortSpec) => {
      const key = Object.keys(sortSpec)[0];
      const dir = sortSpec[key];
      const sorted = [...filtered].sort((a, b) => (dir === -1 ? b[key] - a[key] : a[key] - b[key]));
      return { lean: async () => sorted[0] || null };
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  FAKE_CANDLES = [];
  MarketData.findOne.mockImplementation((query) => {
    let filtered = FAKE_CANDLES.filter((c) => c.asset === query.asset && c.interval === query.interval);
    if (query.timestamp?.$lte) {
      filtered = filtered.filter((c) => c.timestamp.getTime() <= query.timestamp.$lte.getTime());
    }
    return makeQuery(filtered);
  });
});

// benchmarkStartBalance defaults to null (not yet frozen) unless overridden,
// matching a real not-yet-patched or freshly-reset document. `save` mutates
// the same object in place (like a real Mongoose document would) so the
// lazy-freeze logic under test can be observed taking effect.
function makePortfolio(overrides = {}) {
  const doc = {
    startedAt: null, startingBalance: 500, currentBalance: 500, benchmarkStartBalance: null,
    ...overrides,
  };
  doc.save = jest.fn(async () => doc);
  return doc;
}

describe('getBenchmarkComparison', () => {
  test('unavailable when the portfolio has no trades yet (startedAt null)', async () => {
    VirtualPortfolio.findOne.mockResolvedValue(makePortfolio({ startedAt: null }));

    const result = await getBenchmarkComparison();

    expect(result.available).toBe(false);
    expect(result.message).toMatch(/first trade/i);
  });

  test('unavailable when there is no BTC price history at all', async () => {
    VirtualPortfolio.findOne.mockResolvedValue(makePortfolio({
      startedAt: new Date(Date.now() - 30 * 24 * 3_600_000),
      currentBalance: 700,
    }));
    FAKE_CANDLES = [];
    binanceService.getCachedPrice.mockReturnValue(55000);

    const result = await getBenchmarkComparison();

    expect(result.available).toBe(false);
    expect(result.message).toMatch(/no btc price history/i);
  });

  test('reports outperforming the benchmark after 4+ weeks — graduationCriteriaMet true', async () => {
    const startedAt = new Date(Date.now() - 30 * 24 * 3_600_000); // ~4.3 weeks
    VirtualPortfolio.findOne.mockResolvedValue(makePortfolio({ startedAt, currentBalance: 700 })); // +40%
    FAKE_CANDLES = [{ asset: 'BTCUSDT', interval: '1h', timestamp: new Date(startedAt.getTime() - 3_600_000), close: 50000 }];
    binanceService.getCachedPrice.mockReturnValue(55000); // BTC +10% -> benchmark = 550

    const result = await getBenchmarkComparison();

    expect(result.available).toBe(true);
    expect(result.benchmarkValue).toBeCloseTo(550, 2);
    expect(result.outperformingBenchmark).toBe(true);
    expect(result.minWeeksMet).toBe(true);
    expect(result.graduationCriteriaMet).toBe(true);
  });

  test('underperforming the benchmark — graduationCriteriaMet false even past 4 weeks', async () => {
    const startedAt = new Date(Date.now() - 30 * 24 * 3_600_000);
    VirtualPortfolio.findOne.mockResolvedValue(makePortfolio({ startedAt, currentBalance: 520 })); // +4%, BTC +10%
    FAKE_CANDLES = [{ asset: 'BTCUSDT', interval: '1h', timestamp: new Date(startedAt.getTime() - 3_600_000), close: 50000 }];
    binanceService.getCachedPrice.mockReturnValue(55000);

    const result = await getBenchmarkComparison();

    expect(result.outperformingBenchmark).toBe(false);
    expect(result.graduationCriteriaMet).toBe(false);
  });

  test('outperforming but under 4 weeks — graduationCriteriaMet stays false', async () => {
    const startedAt = new Date(Date.now() - 10 * 24 * 3_600_000); // 10 days
    VirtualPortfolio.findOne.mockResolvedValue(makePortfolio({ startedAt, currentBalance: 700 }));
    FAKE_CANDLES = [{ asset: 'BTCUSDT', interval: '1h', timestamp: new Date(startedAt.getTime() - 3_600_000), close: 50000 }];
    binanceService.getCachedPrice.mockReturnValue(55000);

    const result = await getBenchmarkComparison();

    expect(result.outperformingBenchmark).toBe(true);
    expect(result.minWeeksMet).toBe(false);
    expect(result.graduationCriteriaMet).toBe(false);
  });

  test('falls back to the earliest available candle when none exist on/before startedAt, and says so', async () => {
    const startedAt = new Date(Date.now() - 30 * 24 * 3_600_000);
    VirtualPortfolio.findOne.mockResolvedValue(makePortfolio({ startedAt, currentBalance: 700 }));
    // Only a candle AFTER startedAt exists (no $lte match).
    FAKE_CANDLES = [{ asset: 'BTCUSDT', interval: '1h', timestamp: new Date(startedAt.getTime() + 3_600_000), close: 48000 }];
    binanceService.getCachedPrice.mockReturnValue(55000);

    const result = await getBenchmarkComparison();

    expect(result.available).toBe(true);
    expect(result.usedFallbackStartPrice).toBe(true);
    expect(result.btcPriceAtStart).toBe(48000);
  });
});

describe('getBenchmarkComparison — frozen baseline (2026-09-04 regression)', () => {
  /**
   * Regression guard for a real bug: benchmarkValue/portfolioReturnPct used
   * to read `portfolio.startingBalance` directly, but that field isn't
   * frozen -- the admin-only POST /virtual/set-capital endpoint can change
   * it at any later time without touching `startedAt`. A later set-capital
   * call would silently retroact onto the whole benchmark comparison as if
   * the NEW capital had been buying-and-holding BTC since the actual
   * trading-start date, distorting outperformingBenchmark/
   * graduationCriteriaMet -- the exact criterion decision #22 gates moving
   * to real money on.
   */
  const startedAt = new Date(Date.now() - 30 * 24 * 3_600_000);

  beforeEach(() => {
    FAKE_CANDLES = [{ asset: 'BTCUSDT', interval: '1h', timestamp: new Date(startedAt.getTime() - 3_600_000), close: 50000 }];
    binanceService.getCachedPrice.mockReturnValue(55000); // BTC +10%
  });

  test('a later set-capital-style change to startingBalance does NOT retroact onto the benchmark', async () => {
    // Simulates the admin bumping capital via setCapital() well after
    // trading started: benchmarkStartBalance was already frozen at the
    // real $500 on an earlier read (simulated directly here rather than
    // via a second getBenchmarkComparison() call, to isolate this test
    // from the lazy-freeze mechanism itself, which the next test covers),
    // then startingBalance changed to $2000 without touching
    // benchmarkStartBalance or startedAt -- exactly what setCapital() does.
    const portfolio = makePortfolio({
      startedAt, currentBalance: 700, startingBalance: 2000, benchmarkStartBalance: 500,
    });
    VirtualPortfolio.findOne.mockResolvedValue(portfolio);

    const result = await getBenchmarkComparison();

    // Must be computed against the frozen $500, NOT the current $2000
    // setting -- $500 * 1.10 = $550, not $2000 * 1.10 = $2200.
    expect(result.benchmarkValue).toBeCloseTo(550, 2);
    expect(result.startingBalance).toBe(500);
    expect(result.outperformingBenchmark).toBe(true); // $700 > $550
    expect(portfolio.save).not.toHaveBeenCalled(); // already frozen -- no redundant write
  });

  test('benchmarkStartBalance is lazily frozen on first read after startedAt is set', async () => {
    const portfolio = makePortfolio({ startedAt, currentBalance: 700, startingBalance: 500 });
    VirtualPortfolio.findOne.mockResolvedValue(portfolio);

    expect(portfolio.benchmarkStartBalance).toBe(null);
    await getBenchmarkComparison();

    expect(portfolio.save).toHaveBeenCalledTimes(1);
    expect(portfolio.benchmarkStartBalance).toBe(500);
  });

  test('a pre-existing document (predates this fix) with a null benchmarkStartBalance still gets a correct one-time freeze, not a crash', async () => {
    // Same shape a real, already-running, not-yet-migrated portfolio
    // document would have: startedAt set, benchmarkStartBalance absent.
    const portfolio = makePortfolio({ startedAt, currentBalance: 550, startingBalance: 500 });
    delete portfolio.benchmarkStartBalance;
    VirtualPortfolio.findOne.mockResolvedValue(portfolio);

    const result = await getBenchmarkComparison();

    expect(result.available).toBe(true);
    expect(portfolio.benchmarkStartBalance).toBe(500);
  });
});
