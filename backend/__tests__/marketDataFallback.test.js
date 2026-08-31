/**
 * T-084 (2026-08-31): the watchlist went blank in production ("watchlist
 * dont showing any real prices") because Binance became fully unreachable
 * from the backend service (WS stuck reconnecting, REST returning 451 --
 * see binanceService.js's T-084 comment for the live evidence, including
 * the finding that ai-service's identical default Binance calls kept
 * succeeding at the same time, pointing at a Railway region/egress-IP
 * difference between the two services rather than a code bug). Fixing that
 * needs a Railway dashboard change outside this codebase's reach.
 *
 * In the meantime, marketController's price/ticker endpoints had zero
 * fallback: a live-fetch failure meant an empty or 500 response, so the
 * watchlist showed nothing even though MarketData already held recent
 * candles from before the outage. These tests lock in the fallback: a live
 * failure now serves the last-known price/ticker from MarketData, always
 * explicitly marked `stale: true` with a real `asOf` timestamp -- never
 * silently presented as live -- while an actually-unknown symbol (Binance's
 * 400) still 404s regardless of any fallback data, and a genuine live
 * success is unaffected (`stale: false`, unchanged shape plus the new flag).
 */
jest.mock('../src/services/binanceService', () => ({
  fetchCurrentPrice: jest.fn(),
  fetch24hTicker: jest.fn(),
  fetchBatchTickers: jest.fn(),
  getAllCachedPrices: jest.fn(),
  getLastKnownPrice: jest.fn(),
  getLastKnownTickers: jest.fn(),
  TRACKED_ASSETS: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
}));

const binanceService = require('../src/services/binanceService');
const marketController = require('../src/controllers/marketController');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json   = jest.fn(() => res);
  return res;
}

beforeEach(() => jest.clearAllMocks());

describe('getAssetPrice — live vs. fallback (T-084)', () => {
  test('live fetch succeeds: stale: false, no fallback touched', async () => {
    binanceService.fetchCurrentPrice.mockResolvedValue(65000);
    const req = { params: { asset: 'btcusdt' } };
    const res = mockRes();
    const next = jest.fn();

    await marketController.getAssetPrice(req, res, next);

    const payload = res.json.mock.calls[0][0];
    expect(payload).toMatchObject({ success: true, asset: 'BTCUSDT', price: 65000, stale: false });
    expect(binanceService.getLastKnownPrice).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('live fetch fails, fallback data exists: 200 with stale: true and asOf', async () => {
    binanceService.fetchCurrentPrice.mockRejectedValue(new Error('Request failed with status code 451'));
    binanceService.getLastKnownPrice.mockResolvedValue({ asset: 'BTCUSDT', price: 64500, timestamp: new Date('2026-08-31T12:00:00Z') });
    const req = { params: { asset: 'BTCUSDT' } };
    const res = mockRes();
    const next = jest.fn();

    await marketController.getAssetPrice(req, res, next);

    expect(res.status).not.toHaveBeenCalledWith(404);
    const payload = res.json.mock.calls[0][0];
    expect(payload).toMatchObject({ success: true, asset: 'BTCUSDT', price: 64500, stale: true });
    expect(payload.asOf).toBeTruthy();
    expect(next).not.toHaveBeenCalled();
  });

  test('live fetch fails, no fallback data either: passes error to next() (unchanged 500 path)', async () => {
    const err = new Error('Request failed with status code 451');
    binanceService.fetchCurrentPrice.mockRejectedValue(err);
    binanceService.getLastKnownPrice.mockResolvedValue(null);
    const req = { params: { asset: 'BTCUSDT' } };
    const res = mockRes();
    const next = jest.fn();

    await marketController.getAssetPrice(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.json).not.toHaveBeenCalled();
  });

  test('genuinely unknown symbol (Binance 400) still 404s even if fallback data exists', async () => {
    const err = new Error('Bad Request');
    err.response = { status: 400 };
    binanceService.fetchCurrentPrice.mockRejectedValue(err);
    binanceService.getLastKnownPrice.mockResolvedValue({ asset: 'FAKEUSDT', price: 1, timestamp: new Date() });
    const req = { params: { asset: 'FAKEUSDT' } };
    const res = mockRes();
    const next = jest.fn();

    await marketController.getAssetPrice(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(binanceService.getLastKnownPrice).not.toHaveBeenCalled();
  });
});

describe('getAssetTicker — live vs. fallback (T-084)', () => {
  test('live fetch fails, fallback exists: price is real, 24h stats are null (not fabricated), stale: true', async () => {
    binanceService.fetch24hTicker.mockRejectedValue(new Error('timeout'));
    binanceService.getLastKnownPrice.mockResolvedValue({ asset: 'ETHUSDT', price: 3200, timestamp: new Date('2026-08-31T12:00:00Z') });
    const req = { params: { asset: 'ETHUSDT' } };
    const res = mockRes();
    const next = jest.fn();

    await marketController.getAssetTicker(req, res, next);

    const payload = res.json.mock.calls[0][0];
    expect(payload.price).toBe(3200);
    expect(payload.stale).toBe(true);
    expect(payload.changePercent).toBeNull();
    expect(payload.change24h).toBeNull();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('getBatchTickers — live vs. fallback (T-084)', () => {
  test('live batch succeeds: stale: false', async () => {
    binanceService.fetchBatchTickers.mockResolvedValue([{ asset: 'BTCUSDT', price: 65000 }]);
    const req = { body: { assets: ['BTCUSDT'] }, query: {} };
    const res = mockRes();
    const next = jest.fn();

    await marketController.getBatchTickers(req, res, next);

    const payload = res.json.mock.calls[0][0];
    expect(payload.stale).toBe(false);
    expect(binanceService.getLastKnownTickers).not.toHaveBeenCalled();
  });

  test('live batch fails: falls back to last-known tickers, each marked stale, still 200 (not 500)', async () => {
    binanceService.fetchBatchTickers.mockRejectedValue(new Error('Request failed with status code 451'));
    binanceService.getLastKnownTickers.mockResolvedValue([
      { asset: 'BTCUSDT', price: 64500, timestamp: new Date('2026-08-31T12:00:00Z') },
      { asset: 'ETHUSDT', price: 3200, timestamp: new Date('2026-08-31T12:00:00Z') },
    ]);
    const req = { body: { assets: ['BTCUSDT', 'ETHUSDT'] }, query: {} };
    const res = mockRes();
    const next = jest.fn();

    await marketController.getBatchTickers(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.stale).toBe(true);
    expect(payload.tickers).toHaveLength(2);
    expect(payload.tickers[0]).toMatchObject({ asset: 'BTCUSDT', price: 64500, stale: true });
  });

  test('live batch fails and no fallback data exists: 200 with an empty ticker array, not an error', async () => {
    binanceService.fetchBatchTickers.mockRejectedValue(new Error('Request failed with status code 451'));
    binanceService.getLastKnownTickers.mockResolvedValue([]);
    const req = { body: { assets: ['BTCUSDT'] }, query: {} };
    const res = mockRes();
    const next = jest.fn();

    await marketController.getBatchTickers(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.tickers).toEqual([]);
    expect(payload.stale).toBe(false);
  });

  test('unsupported symbols (not in TRACKED_ASSETS) are filtered out before ever touching Binance or fallback', async () => {
    const req = { body: { assets: ['XAUUSD'] }, query: {} };
    const res = mockRes();
    const next = jest.fn();

    await marketController.getBatchTickers(req, res, next);

    expect(binanceService.fetchBatchTickers).not.toHaveBeenCalled();
    expect(binanceService.getLastKnownTickers).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0]).toEqual({ success: true, tickers: [], stale: false });
  });
});

describe('getLivePrices — in-memory cache vs. fallback (T-084)', () => {
  test('cache populated: served directly, stale: false', async () => {
    binanceService.getAllCachedPrices.mockReturnValue({ BTCUSDT: { price: 65000, ts: Date.now() } });
    const res = mockRes();

    await marketController.getLivePrices({}, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.stale).toBe(false);
    expect(payload.count).toBe(1);
    expect(binanceService.getLastKnownTickers).not.toHaveBeenCalled();
  });

  test('cache empty (WS + REST poll both down): falls back to MarketData, stale: true', async () => {
    binanceService.getAllCachedPrices.mockReturnValue({});
    binanceService.getLastKnownTickers.mockResolvedValue([
      { asset: 'BTCUSDT', price: 64500, timestamp: new Date('2026-08-31T12:00:00Z') },
    ]);
    const res = mockRes();

    await marketController.getLivePrices({}, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.stale).toBe(true);
    expect(payload.prices.BTCUSDT.price).toBe(64500);
  });

  test('cache empty and no fallback data either: 200 with an empty set, not an error', async () => {
    binanceService.getAllCachedPrices.mockReturnValue({});
    binanceService.getLastKnownTickers.mockResolvedValue([]);
    const res = mockRes();

    await marketController.getLivePrices({}, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.stale).toBe(false);
    expect(payload.prices).toEqual({});
  });
});
