/**
 * Regression suite for the autonomous AI trading cycle. Protects against two
 * real bugs found and fixed on 2026-08-09:
 *  1. `portfolio` was read before its `const` declaration (temporal dead
 *     zone) inside the daily-loss-limit check -- this crashed with a
 *     ReferenceError on every single 5-minute cycle since deployment.
 *  2. The daily-loss aggregate filtered `status: 'closed'`, a value that no
 *     VirtualTrade document ever actually has (real values are
 *     'closed_profit'/'closed_loss') -- so the safety check silently never
 *     matched anything, even after fix #1.
 * All Mongoose models and axios are faked in-memory; no live services touched.
 */
const BudgetSession       = require('../src/models/BudgetSession');
const VirtualTrade        = require('../src/models/VirtualTrade');
const VirtualPortfolio    = require('../src/models/VirtualPortfolio');
const AIDecision          = require('../src/models/AIDecision');
const MarketRegimeHistory = require('../src/models/MarketRegimeHistory');
const axios                = require('axios');

let FAKE_PORTFOLIO, FAKE_AGGREGATE_RESULT, CREATED_TRADES, SCAN_RESPONSE;

beforeEach(() => {
  FAKE_PORTFOLIO = { currentBalance: 1000, riskPerTradePct: 5, save: async () => {} };
  FAKE_AGGREGATE_RESULT = [];
  CREATED_TRADES = [];
  SCAN_RESPONSE = { success: true, scanned: 1, top_opportunities: [] };

  BudgetSession.findOne = async () => ({ status: 'active' });
  VirtualTrade.countDocuments = async () => 0;
  VirtualTrade.aggregate = async () => FAKE_AGGREGATE_RESULT;
  VirtualTrade.distinct = async () => [];
  VirtualTrade.create = async (doc) => { CREATED_TRADES.push(doc); return { ...doc, _id: 'fake_' + CREATED_TRADES.length }; };
  VirtualPortfolio.findOne = async () => FAKE_PORTFOLIO;
  AIDecision.create = async (doc) => ({ ...doc, _id: 'decision_fake' });
  AIDecision.updateOne = async () => {};
  MarketRegimeHistory.create = async () => ({});
  axios.post = async () => ({ data: SCAN_RESPONSE });

  process.env.AI_CONFIDENCE_THRESHOLD = '0';
  process.env.AI_MIN_FUSED_SCORE = '0';
  process.env.AI_MIN_QUALITY_SCORE = '0';
});

const { runAIWorkerCycle } = require('../src/services/aiWorkerService');

test('runAIWorkerCycle completes without throwing (regression: TDZ crash on every cycle)', async () => {
  await expect(runAIWorkerCycle()).resolves.toBeDefined();
});

test('daily loss limit actually pauses trading when losses meet the threshold (regression: dead status filter)', async () => {
  // 5% of $1000 = $50 threshold. Simulate $60 in today's realized losses.
  FAKE_AGGREGATE_RESULT = [{ _id: null, totalLoss: -60 }];
  const result = await runAIWorkerCycle();
  expect(result.skipped).toBe('daily_loss_limit');
});

test('daily loss limit does NOT trigger when losses are below the threshold', async () => {
  FAKE_AGGREGATE_RESULT = [{ _id: null, totalLoss: -10 }];
  SCAN_RESPONSE = { success: true, scanned: 1, top_opportunities: [] };
  const result = await runAIWorkerCycle();
  expect(result.skipped).not.toBe('daily_loss_limit');
});

test('opened trade sizing respects the hard position-size cap even at max risk config', async () => {
  FAKE_PORTFOLIO = { currentBalance: 1000, riskPerTradePct: 50, save: async () => {} }; // worst-case config
  SCAN_RESPONSE = {
    success: true, scanned: 1,
    top_opportunities: [{
      asset: 'FAKEUSDT', action: 'BUY', confidence: 99, fused_score: 99, quality_score: 99,
      current_price: 100, stop_loss: 95, take_profit: 110,
    }],
  };
  const result = await runAIWorkerCycle();
  expect(result.tradesCreated).toBe(1);
  const riskPct = (CREATED_TRADES[0].sizeUsd / 1000) * 100;
  expect(riskPct).toBeLessThanOrEqual(10 + 1e-9); // MAX_POSITION_RISK_PCT
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
