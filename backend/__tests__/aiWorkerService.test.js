/**
 * Regression suite for the AI worker's PROPOSAL cycle (master-plan decision
 * #11, 2026-09-03: the worker no longer opens VirtualTrades on its own — it
 * only ever creates an AIDecision with status 'PENDING_APPROVAL', and a
 * separate human action (approveDecision/rejectDecision, below) is the only
 * path that can turn a proposal into a real paper trade).
 *
 * Also protects the older regressions this file predates:
 *  1. `portfolio` read before its `const` declaration (temporal dead zone)
 *     inside the daily-loss check — crashed every 5-minute cycle.
 *  2. The daily-loss aggregate filtering a `status` value no VirtualTrade
 *     document ever has.
 * Both are now covered indirectly via riskStateService.checkAndMaybeHalt,
 * which this suite mocks at the RiskState/VirtualTrade level same as before.
 *
 * All Mongoose models and axios are faked in-memory; no live services touched.
 */
jest.mock('../src/jobs/globalScanJob', () => ({ getCache: jest.fn(() => null) }));

const BudgetSession       = require('../src/models/BudgetSession');
const VirtualTrade        = require('../src/models/VirtualTrade');
const VirtualPortfolio    = require('../src/models/VirtualPortfolio');
const AIDecision          = require('../src/models/AIDecision');
const RiskState           = require('../src/models/RiskState');
const MarketRegimeHistory = require('../src/models/MarketRegimeHistory');
const axios                = require('axios');
const { getCache }         = require('../src/jobs/globalScanJob');

let FAKE_PORTFOLIO, FAKE_AGGREGATE_RESULT, CREATED_DECISIONS, CREATED_TRADES, SCAN_RESPONSE, FAKE_RISK_STATE;

function makeRiskState(overrides = {}) {
  const state = { riskKey: 'global', dailyLossHalted: false, haltReason: null, ...overrides };
  state.save = async () => state;
  return state;
}

beforeEach(() => {
  FAKE_PORTFOLIO = { currentBalance: 1000, riskPerTradePct: 5, save: async () => {} };
  FAKE_AGGREGATE_RESULT = [];
  CREATED_DECISIONS = [];
  CREATED_TRADES = [];
  SCAN_RESPONSE = { success: true, scanned: 1, top_opportunities: [] };
  FAKE_RISK_STATE = makeRiskState();

  BudgetSession.findOne = async () => ({ status: 'active' });
  VirtualTrade.countDocuments = async () => 0;
  VirtualTrade.aggregate = async () => FAKE_AGGREGATE_RESULT; // used by riskStateService.checkAndMaybeHalt
  VirtualTrade.distinct = async () => [];
  VirtualTrade.findOne = async () => null; // no already-open position, for approveDecision tests
  VirtualTrade.create = async (doc) => { const t = { ...doc, _id: 'trade_' + (CREATED_TRADES.length + 1) }; CREATED_TRADES.push(t); return t; };
  VirtualPortfolio.findOne = async () => FAKE_PORTFOLIO;
  AIDecision.create = async (doc) => {
    const d = { ...doc, _id: 'decision_' + (CREATED_DECISIONS.length + 1), save: async function () { return this; } };
    CREATED_DECISIONS.push(d);
    return d;
  };
  AIDecision.updateOne = async () => {};
  AIDecision.findById = async (id) => CREATED_DECISIONS.find(d => d._id === id) || null;
  RiskState.findOne = async () => FAKE_RISK_STATE;
  RiskState.create = async () => FAKE_RISK_STATE;
  MarketRegimeHistory.create = async () => ({});
  axios.post = jest.fn(async () => ({ data: SCAN_RESPONSE }));
  getCache.mockReturnValue(null); // default: no cache -> falls back to a direct scan call

  process.env.AI_CONFIDENCE_THRESHOLD = '0';
  process.env.AI_MIN_FUSED_SCORE = '0';
  process.env.AI_MIN_QUALITY_SCORE = '0';
});

const { runAIWorkerCycle, approveDecision, rejectDecision, getPendingDecision } = require('../src/services/aiWorkerService');

test('runAIWorkerCycle completes without throwing (regression: TDZ crash on every cycle)', async () => {
  await expect(runAIWorkerCycle()).resolves.toBeDefined();
});

test('never calls VirtualTrade.create — proposals only (decision #11)', async () => {
  SCAN_RESPONSE = {
    success: true, scanned: 1,
    top_opportunities: [{
      asset: 'FAKEUSDT', action: 'BUY', confidence: 99, fused_score: 99, quality_score: 99,
      current_price: 100, stop_loss: 95, take_profit: 110,
    }],
  };
  const result = await runAIWorkerCycle();
  expect(result.proposalsCreated).toBe(1);
  expect(CREATED_TRADES).toHaveLength(0); // the whole point of this refactor
  expect(CREATED_DECISIONS).toHaveLength(1);
  expect(CREATED_DECISIONS[0].status).toBe('PENDING_APPROVAL');
  expect(CREATED_DECISIONS[0].tradeCreated).toBeFalsy();
});

test('daily-loss circuit breaker pauses proposals when the threshold is hit (decision #16)', async () => {
  // 10% of $1000 = $100 threshold. Simulate $150 in today's realized losses.
  FAKE_AGGREGATE_RESULT = [{ _id: null, totalLoss: -150 }];
  const result = await runAIWorkerCycle();
  expect(result.skipped).toBe('daily_loss_halted');
});

test('circuit breaker does NOT trigger below the threshold', async () => {
  FAKE_AGGREGATE_RESULT = [{ _id: null, totalLoss: -10 }];
  SCAN_RESPONSE = { success: true, scanned: 1, top_opportunities: [] };
  const result = await runAIWorkerCycle();
  expect(result.skipped).not.toBe('daily_loss_halted');
});

test('an already-tripped halt blocks proposals even with $0 new losses this call (decision #16: manual reset only)', async () => {
  FAKE_RISK_STATE = makeRiskState({ dailyLossHalted: true, haltReason: 'test halt' });
  const result = await runAIWorkerCycle();
  expect(result.skipped).toBe('daily_loss_halted');
});

test('safety gate rejects an opportunity whose stop-loss implies more than 25% loss — no proposal is created', async () => {
  SCAN_RESPONSE = {
    success: true, scanned: 1,
    top_opportunities: [{
      asset: 'RISKYUSDT', action: 'BUY', confidence: 99, fused_score: 99, quality_score: 99,
      current_price: 100, stop_loss: 60, take_profit: 200, // 40% away — over the 25% ceiling
    }],
  };
  const result = await runAIWorkerCycle();
  expect(result.proposalsCreated).toBe(0);
  expect(CREATED_DECISIONS).toHaveLength(0);
});

test('skips cleanly when the budget session is inactive', async () => {
  BudgetSession.findOne = async () => ({ status: 'paused' });
  const result = await runAIWorkerCycle();
  expect(result.skipped).toBe('session_inactive');
});

test('skips cleanly when max open trades is reached', async () => {
  VirtualTrade.countDocuments = async () => 999;
  const result = await runAIWorkerCycle();
  expect(result.skipped).toBe('max_trades_reached');
});

test('the per-cycle proposal loop never lets open+pending exceed MAX_OPEN_TRADES (regression: 2026-08-18 risk-cap bug, adapted for proposals)', async () => {
  VirtualTrade.countDocuments = async () => 4; // below MAX_OPEN_TRADES=5
  SCAN_RESPONSE = {
    success: true, scanned: 3,
    top_opportunities: [
      { asset: 'AAAUSDT', action: 'BUY',  confidence: 99, fused_score: 99, quality_score: 99, current_price: 100, stop_loss: 95,  take_profit: 110 },
      { asset: 'BBBUSDT', action: 'BUY',  confidence: 99, fused_score: 99, quality_score: 99, current_price: 200, stop_loss: 190, take_profit: 220 },
      { asset: 'CCCUSDT', action: 'SELL', confidence: 99, fused_score: 99, quality_score: 99, current_price: 300, stop_loss: 310, take_profit: 280 },
    ],
  };

  const result = await runAIWorkerCycle();

  expect(result.proposalsCreated).toBe(1); // not 3
  expect(4 + result.proposalsCreated).toBeLessThanOrEqual(5);
});

test('MAX_NEW_PER_CYCLE still caps a cycle when there is plenty of room under MAX_OPEN_TRADES', async () => {
  VirtualTrade.countDocuments = async () => 0;
  SCAN_RESPONSE = {
    success: true, scanned: 3,
    top_opportunities: [
      { asset: 'AAAUSDT', action: 'BUY',  confidence: 99, fused_score: 99, quality_score: 99, current_price: 100, stop_loss: 95,  take_profit: 110 },
      { asset: 'BBBUSDT', action: 'BUY',  confidence: 99, fused_score: 99, quality_score: 99, current_price: 200, stop_loss: 190, take_profit: 220 },
      { asset: 'CCCUSDT', action: 'SELL', confidence: 99, fused_score: 99, quality_score: 99, current_price: 300, stop_loss: 310, take_profit: 280 },
    ],
  };
  const result = await runAIWorkerCycle();
  expect(result.proposalsCreated).toBe(3);
});

describe('runAIWorkerCycle — reuses globalScanJob\'s cache instead of always re-scanning (T-060)', () => {
  const cachedOpportunity = {
    asset: 'CACHEDUSDT', action: 'BUY', confidence: 99, fused_score: 99, quality_score: 99,
    current_price: 50, stop_loss: 45, take_profit: 60,
  };

  test('uses the cached scan and does NOT call axios.post when the cache is fresh', async () => {
    getCache.mockReturnValue({
      result:    { success: true, scanned: 1, top_opportunities: [cachedOpportunity] },
      scannedAt: new Date(Date.now() - 5 * 60 * 1000),
    });
    const result = await runAIWorkerCycle();
    expect(axios.post).not.toHaveBeenCalled();
    expect(result.proposalsCreated).toBe(1);
    expect(CREATED_DECISIONS[0].asset).toBe('CACHEDUSDT');
  });

  test('falls back to a direct scan call when the cache is stale', async () => {
    getCache.mockReturnValue({
      result:    { success: true, scanned: 1, top_opportunities: [cachedOpportunity] },
      scannedAt: new Date(Date.now() - 40 * 60 * 1000),
    });
    SCAN_RESPONSE = { success: true, scanned: 1, top_opportunities: [] };
    const result = await runAIWorkerCycle();
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(result.skipped).toBe('no_opportunities');
    expect(CREATED_DECISIONS).toHaveLength(0);
  });
});

describe('runAIWorkerCycle — persists atrAtEntry on the decision (T-073, adapted for proposals)', () => {
  test('atrAtEntry is populated from the opportunity\'s own atr field', async () => {
    SCAN_RESPONSE = {
      success: true, scanned: 1,
      top_opportunities: [{
        asset: 'ATRUSDT', action: 'BUY', confidence: 99, fused_score: 99, quality_score: 99,
        current_price: 100, stop_loss: 95, take_profit: 110, atr: 3.3333,
      }],
    };
    const result = await runAIWorkerCycle();
    expect(result.proposalsCreated).toBe(1);
    expect(CREATED_DECISIONS[0].atrAtEntry).toBe(3.3333);
  });
});

describe('approveDecision — the only path that opens a real (paper) trade (decision #11)', () => {
  async function proposeOne(opp) {
    SCAN_RESPONSE = { success: true, scanned: 1, top_opportunities: [opp] };
    await runAIWorkerCycle();
    return CREATED_DECISIONS[CREATED_DECISIONS.length - 1];
  }

  test('approving a pending decision opens exactly one trade and marks the decision APPROVED', async () => {
    const decision = await proposeOne({
      asset: 'APPROVEUSDT', action: 'BUY', confidence: 99, fused_score: 99, quality_score: 99,
      current_price: 100, stop_loss: 95, take_profit: 110,
    });

    const trade = await approveDecision(decision._id);

    expect(trade).toBeDefined();
    expect(CREATED_TRADES).toHaveLength(1);
    expect(CREATED_TRADES[0].asset).toBe('APPROVEUSDT');
    expect(CREATED_TRADES[0].origin).toBe('ai_worker_approved');
    expect(decision.status).toBe('APPROVED');
    expect(decision.tradeCreated).toBe(true);
  });

  test('approving the same decision twice fails the second time', async () => {
    const decision = await proposeOne({
      asset: 'TWICEUSDT', action: 'BUY', confidence: 99, fused_score: 99, quality_score: 99,
      current_price: 100, stop_loss: 95, take_profit: 110,
    });
    await approveDecision(decision._id);
    await expect(approveDecision(decision._id)).rejects.toThrow(/already approved/i);
  });

  test('rejectDecision marks the decision REJECTED without ever calling VirtualTrade.create', async () => {
    const decision = await proposeOne({
      asset: 'REJECTUSDT', action: 'BUY', confidence: 99, fused_score: 99, quality_score: 99,
      current_price: 100, stop_loss: 95, take_profit: 110,
    });
    await rejectDecision(decision._id);
    expect(decision.status).toBe('REJECTED');
    expect(CREATED_TRADES).toHaveLength(0);
  });
});

describe('getPendingDecision', () => {
  test('returns null when there is nothing pending', async () => {
    AIDecision.findOne = () => ({ sort: () => ({ lean: async () => null }) });
    const pending = await getPendingDecision();
    expect(pending).toBeNull();
  });
});
