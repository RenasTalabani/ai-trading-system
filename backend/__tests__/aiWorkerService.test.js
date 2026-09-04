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
// approveDecision() calls through to virtualTrackingService's real
// approveSuggestion(), which fires a fire-and-forget push notification via a
// lazy require('./notificationService') on success. Left unmocked here, that
// hits the real Mongoose/Firebase-backed service with no live connection and
// the approveDecision tests hang to Jest's timeout -- same class of gap as
// virtualTrackingService.test.js already guards against for the same reason.
jest.mock('../src/services/notificationService', () => ({
  sendTradeOpenedNotification: jest.fn(async () => {}),
  sendTradeClosedNotification: jest.fn(async () => {}),
  sendProposalExpiredNotification: jest.fn(async () => {}),
}));

const BudgetSession       = require('../src/models/BudgetSession');
const VirtualTrade        = require('../src/models/VirtualTrade');
const VirtualPortfolio    = require('../src/models/VirtualPortfolio');
const AIDecision          = require('../src/models/AIDecision');
const AllocationProposal  = require('../src/models/AllocationProposal');
const RiskState           = require('../src/models/RiskState');
const MarketRegimeHistory = require('../src/models/MarketRegimeHistory');
const axios                = require('axios');
const { getCache }         = require('../src/jobs/globalScanJob');

let FAKE_PORTFOLIO, FAKE_AGGREGATE_RESULT, CREATED_DECISIONS, CREATED_TRADES, CREATED_PROPOSALS, SCAN_RESPONSE, FAKE_RISK_STATE;

function makeRiskState(overrides = {}) {
  const state = { riskKey: 'global', dailyLossHalted: false, haltReason: null, ...overrides };
  state.save = async () => state;
  return state;
}

function chain(result) {
  return { sort: () => ({ limit: () => ({ lean: async () => result }) }) };
}

// Bug fix (2026-09-04, overnight continuous-improvement pass, follow-up):
// real Mongoose accepts EITHER a bare field object (`{status: 'X'}`, which
// Mongoose's own castUpdate implicitly treats as `$set`) OR an explicit
// `{$set: {...}}` operator document -- both apply identically against a
// real MongoDB. This file's AIDecision.updateOne/updateMany mocks only
// handled the bare-field style (plain `Object.assign(d, update)`), because
// every call site in aiWorkerService.js used that style until
// _expireOneProposal() (also added 2026-09-04) used explicit `$set` for the
// same effect. That single call being $set-wrapped, combined with the
// mock's blind Object.assign, meant `Object.assign(d, {$set: {...}})` just
// added a literal `$set` property to the fake decision instead of actually
// setting its `status`/`decidedAt` -- so
// "...its decisions too" looked like a real production bug (children never
// reaching EXPIRED) when the underlying fix was correct all along and only
// this fixture's Mongo-update emulation was incomplete.
function applyMongoUpdate(doc, update) {
  if (update && typeof update === 'object' && update.$set) {
    Object.assign(doc, update.$set);
  } else {
    Object.assign(doc, update);
  }
}

beforeEach(() => {
  // Bug fix (2026-09-04, overnight continuous-improvement pass, follow-up):
  // this file's mocked notificationService/axios call histories were never
  // cleared between tests. Every mock.fn() here lives at module scope (set
  // up once by jest.mock() at the top of the file), so without this, a call
  // made in an EARLIER test stays on the mock's `.mock.calls` history for
  // every test that runs after it in the same file. That's exactly why 'a
  // fresh proposal ... is never touched' (line ~236) started failing the
  // moment the previous test in file order legitimately called
  // sendProposalExpiredNotification once: this test's own
  // `not.toHaveBeenCalled()` check was seeing that carried-over call, not a
  // spurious call made during itself. jest.clearAllMocks() only resets call/
  // instance/result history (not implementations set via jest.fn(impl) at
  // creation time), so it's safe here and doesn't need re-establishing
  // afterwards.
  jest.clearAllMocks();
  FAKE_PORTFOLIO = { currentBalance: 1000, riskPerTradePct: 5, save: async () => {} };
  FAKE_AGGREGATE_RESULT = [];
  CREATED_DECISIONS = [];
  CREATED_TRADES = [];
  CREATED_PROPOSALS = [];
  SCAN_RESPONSE = { success: true, scanned: 1, top_opportunities: [] };
  FAKE_RISK_STATE = makeRiskState();

  BudgetSession.findOne = async () => ({ status: 'active' });
  VirtualTrade.countDocuments = async () => 0;
  VirtualTrade.aggregate = async () => FAKE_AGGREGATE_RESULT; // used by riskStateService.checkAndMaybeHalt
  VirtualTrade.distinct = async () => [];
  VirtualTrade.find = () => chain([]); // used by computeSpotSizeUsd -> getEdgeMultiplier (no trade history -> 1.0x)
  VirtualTrade.findOne = async () => null; // no already-open position, for approveDecision tests
  VirtualTrade.create = async (doc) => { const t = { ...doc, _id: 'trade_' + (CREATED_TRADES.length + 1) }; CREATED_TRADES.push(t); return t; };
  VirtualPortfolio.findOne = async () => FAKE_PORTFOLIO;
  AIDecision.create = async (doc) => {
    const d = { ...doc, _id: 'decision_' + (CREATED_DECISIONS.length + 1), save: async function () { return this; } };
    CREATED_DECISIONS.push(d);
    return d;
  };
  // Mutate the in-memory fakes for real, the same way Mongo would apply the
  // update -- otherwise tests that check a decision's status after
  // approveAllocationProposal/rejectAllocationProposal would trivially pass
  // no matter what those functions actually did.
  AIDecision.updateOne = async (filter, update) => {
    const d = CREATED_DECISIONS.find(x => String(x._id) === String(filter._id));
    if (d) applyMongoUpdate(d, update);
  };
  AIDecision.updateMany = async (filter, update) => {
    const ids = (filter._id && filter._id.$in ? filter._id.$in : []).map(String);
    for (const d of CREATED_DECISIONS) {
      if (ids.includes(String(d._id)) && (!filter.status || d.status === filter.status)) {
        applyMongoUpdate(d, update);
      }
    }
  };
  AIDecision.findById = async (id) => CREATED_DECISIONS.find(d => d._id === id) || null;
  AllocationProposal.findOne = async () => null; // default: nothing pending yet
  // expireStalePendingProposals() now runs at the very top of every
  // runAIWorkerCycle() call (see the fix this default supports) -- default
  // to "nothing stale" so every pre-existing test in this file, none of
  // which is about expiry, keeps behaving exactly as before.
  AllocationProposal.find = async () => [];
  AllocationProposal.create = async (doc) => {
    const p = {
      ...doc,
      _id: 'proposal_' + (CREATED_PROPOSALS.length + 1),
      save: async function () { return this; },
    };
    CREATED_PROPOSALS.push(p);
    return p;
  };
  AllocationProposal.findById = async (id) => CREATED_PROPOSALS.find(p => p._id === id) || null;
  // approveAllocationProposal() (2026-09-04 fix) claims a proposal
  // atomically via findOneAndUpdate instead of findById()+save(), to close
  // a real concurrent-approval race (see approveAllocationProposalRace.test.js)
  // -- mutate the SAME in-memory object findById()/the assertions below
  // already hold a reference to, the same way Mongo's real findOneAndUpdate
  // would apply the update to the one real document.
  AllocationProposal.findOneAndUpdate = async (filter, update) => {
    const p = CREATED_PROPOSALS.find(x => String(x._id) === String(filter._id));
    if (!p || (filter.status && p.status !== filter.status)) return null;
    Object.assign(p, update);
    return p;
  };
  AllocationProposal.updateOne = async (filter, update) => {
    const p = CREATED_PROPOSALS.find(x => String(x._id) === String(filter._id));
    if (p) Object.assign(p, update);
  };
  RiskState.findOne = async () => FAKE_RISK_STATE;
  RiskState.create = async () => FAKE_RISK_STATE;
  MarketRegimeHistory.create = async () => ({});
  axios.post = jest.fn(async () => ({ data: SCAN_RESPONSE }));
  getCache.mockReturnValue(null); // default: no cache -> falls back to a direct scan call
});

// aiWorkerService.js reads these into module-level `const`s at require time
// (CONFIDENCE_THRESHOLD/MIN_FUSED_SCORE/MIN_QUALITY_SCORE), so setting them
// inside beforeEach() (as this file used to) has no effect -- that callback
// only runs once Jest starts executing a test, which is always AFTER this
// file's own top-level require() below has already evaluated the constants.
// Moved here so the assignment at least happens before that require() runs.
//
// NOTE (found chasing the still-failing BEST1/BEST2 allocation test after
// this move alone didn't fix it): aiWorkerService.js reads these with
// `parseInt(process.env.X) || <default>` -- and `0 || 70` is 70 in
// JavaScript, because 0 is falsy. So even with correct timing, "0" can
// never actually zero out these thresholds; the real production defaults
// (70/65/75) apply regardless. That's a separate, pre-existing bug in
// production code unrelated to any master-plan safety limit (this is an
// AI-signal-quality knob, not a leverage/stop-loss/daily-loss number) --
// left untouched here per the standing instruction to keep this fix scoped
// to tests. Every fixture in this file is chosen to clear the *real*
// defaults on its own merits (see BEST2 below), so none of them actually
// depend on this override working.
process.env.AI_CONFIDENCE_THRESHOLD = '0';
process.env.AI_MIN_FUSED_SCORE = '0';
process.env.AI_MIN_QUALITY_SCORE = '0';

const {
  runAIWorkerCycle, approveDecision, rejectDecision, getPendingDecision,
  approveAllocationProposal, rejectAllocationProposal, getPendingProposal,
  expireStalePendingProposals,
} = require('../src/services/aiWorkerService');
const notificationService = require('../src/services/notificationService');

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

  // Decision #14: candidates get bundled into one allocation proposal too.
  expect(result.proposalId).toBeDefined();
  expect(CREATED_PROPOSALS).toHaveLength(1);
  expect(CREATED_PROPOSALS[0].status).toBe('PENDING_APPROVAL');
  expect(CREATED_PROPOSALS[0].options[0].key).toBe('best_single');
});

test('a pending proposal blocks a new cycle from creating another one (decision #21: one card at a time)', async () => {
  AllocationProposal.findOne = async () => ({ _id: 'proposal_existing', status: 'PENDING_APPROVAL' });
  SCAN_RESPONSE = {
    success: true, scanned: 1,
    top_opportunities: [{
      asset: 'FAKEUSDT', action: 'BUY', confidence: 99, fused_score: 99, quality_score: 99,
      current_price: 100, stop_loss: 95, take_profit: 110,
    }],
  };
  const result = await runAIWorkerCycle();
  expect(result.skipped).toBe('pending_proposal_exists');
  expect(CREATED_DECISIONS).toHaveLength(0);
});

// Bug found 2026-09-04 (overnight continuous-improvement pass): the guard
// above -- "one pending decision at a time" -- had no matching expiry, so a
// proposal nobody ever answered blocked the worker from proposing anything
// new FOREVER, and an old-price proposal approved days later would still
// open a trade at that stale price. expireStalePendingProposals() (called
// at the very top of every runAIWorkerCycle()) is the fix; see its own
// comment in aiWorkerService.js for the full reasoning.
describe('expireStalePendingProposals — a proposal nobody answers eventually clears itself (bug fix, 2026-09-04)', () => {
  function makeProposal(id, ageHours, status = 'PENDING_APPROVAL') {
    const decisionIds = [`${id}-decA`, `${id}-decB`];
    for (const did of decisionIds) {
      CREATED_DECISIONS.push({ _id: did, status: 'PENDING_APPROVAL' });
    }
    return {
      _id: id,
      status,
      createdAt: new Date(Date.now() - ageHours * 3_600_000),
      options: [{ key: 'opt1', allocations: decisionIds.map(aiDecisionId => ({ aiDecisionId })) }],
      decidedAt: null,
      save: async function () { return this; },
    };
  }

  test('a 4h-old (past the 3h default) PENDING_APPROVAL proposal is marked EXPIRED, its decisions too', async () => {
    const stale = makeProposal('stale1', 4);
    AllocationProposal.find = async () => [stale];

    await expireStalePendingProposals();

    expect(stale.status).toBe('EXPIRED');
    expect(stale.decidedAt).not.toBeNull();
    expect(CREATED_DECISIONS.filter(d => d._id.startsWith('stale1')).every(d => d.status === 'EXPIRED')).toBe(true);
    expect(notificationService.sendProposalExpiredNotification).toHaveBeenCalledWith(stale);
  });

  test('a fresh proposal (under the cutoff) is never touched — AllocationProposal.find already filters by createdAt, this just documents the contract', async () => {
    AllocationProposal.find = async () => []; // a real cutoff query would exclude a fresh one
    await expireStalePendingProposals();
    expect(notificationService.sendProposalExpiredNotification).not.toHaveBeenCalled();
  });

  test('runAIWorkerCycle expires a stale proposal and then proceeds — the app is never stuck forever (the actual bug)', async () => {
    const stale = makeProposal('stale2', 5);
    // First call still sees it (as the real query would, before it's saved);
    // once expired, a second read (what the existingPending check does next
    // in the SAME cycle) must no longer see it as PENDING_APPROVAL.
    AllocationProposal.find   = async () => [stale];
    AllocationProposal.findOne = async () => (stale.status === 'PENDING_APPROVAL' ? stale : null);
    SCAN_RESPONSE = {
      success: true, scanned: 1,
      top_opportunities: [{
        asset: 'UNSTUCKUSDT', action: 'BUY', confidence: 99, fused_score: 99, quality_score: 99,
        current_price: 100, stop_loss: 95, take_profit: 110,
      }],
    };

    const result = await runAIWorkerCycle();

    expect(stale.status).toBe('EXPIRED');
    expect(result.skipped).not.toBe('pending_proposal_exists');
    expect(result.proposalsCreated).toBe(1); // a brand new proposal was created in the same cycle
  });
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

describe('approveAllocationProposal / rejectAllocationProposal — the single-screen surface (decisions #11 + #14)', () => {
  async function proposeCycle(opps) {
    SCAN_RESPONSE = { success: true, scanned: opps.length, top_opportunities: opps };
    const result = await runAIWorkerCycle();
    return CREATED_PROPOSALS.find(p => p._id === String(result.proposalId));
  }

  test('approving "best_single" opens exactly one trade and closes out every decision from that cycle', async () => {
    const proposal = await proposeCycle([
      { asset: 'BEST1', action: 'BUY', confidence: 90, fused_score: 90, quality_score: 90, current_price: 100, stop_loss: 95, take_profit: 110 },
      // quality_score must clear the real MIN_QUALITY_SCORE default (75) --
      // see the note above the env-var overrides near the top of this file
      // for why "70" silently never reached buildAllocationOptions() at all.
      { asset: 'BEST2', action: 'BUY', confidence: 80, fused_score: 80, quality_score: 80, current_price: 200, stop_loss: 190, take_profit: 220 },
    ]);
    expect(proposal.options.map(o => o.key)).toEqual(expect.arrayContaining(['best_single', 'diversified', 'single_BEST2']));

    const { trades, failures } = await approveAllocationProposal(proposal._id, 'best_single');

    expect(failures).toHaveLength(0);
    expect(trades).toHaveLength(1);
    expect(trades[0].asset).toBe('BEST1'); // highest confidence -> the recommended single
    expect(proposal.status).toBe('APPROVED');
    expect(proposal.chosenOptionKey).toBe('best_single');

    // BEST2's decision was never chosen -> closed out as REJECTED, not left dangling.
    const best2Decision = CREATED_DECISIONS.find(d => d.asset === 'BEST2');
    expect(best2Decision.status).toBe('REJECTED');
  });

  test('approving "diversified" opens one trade per asset in that option', async () => {
    const proposal = await proposeCycle([
      { asset: 'DIVA', action: 'BUY', confidence: 90, fused_score: 90, quality_score: 90, current_price: 100, stop_loss: 95, take_profit: 110 },
      { asset: 'DIVB', action: 'BUY', confidence: 80, fused_score: 80, quality_score: 80, current_price: 200, stop_loss: 190, take_profit: 220 },
    ]);
    const { trades, failures } = await approveAllocationProposal(proposal._id, 'diversified');
    expect(failures).toHaveLength(0);
    expect(trades.map(t => t.asset).sort()).toEqual(['DIVA', 'DIVB']);
  });

  test('approving an unknown option key throws', async () => {
    const proposal = await proposeCycle([
      { asset: 'ONLYONE', action: 'BUY', confidence: 90, fused_score: 90, quality_score: 90, current_price: 100, stop_loss: 95, take_profit: 110 },
    ]);
    await expect(approveAllocationProposal(proposal._id, 'not_a_real_option')).rejects.toThrow(/not one of this proposal/i);
  });

  test('approving an already-decided proposal fails', async () => {
    const proposal = await proposeCycle([
      { asset: 'DECIDEDONCE', action: 'BUY', confidence: 90, fused_score: 90, quality_score: 90, current_price: 100, stop_loss: 95, take_profit: 110 },
    ]);
    await approveAllocationProposal(proposal._id, 'best_single');
    await expect(approveAllocationProposal(proposal._id, 'best_single')).rejects.toThrow(/already approved/i);
  });

  test('rejectAllocationProposal closes out every decision from that cycle without opening any trade', async () => {
    const proposal = await proposeCycle([
      { asset: 'REJONE', action: 'BUY', confidence: 90, fused_score: 90, quality_score: 90, current_price: 100, stop_loss: 95, take_profit: 110 },
      { asset: 'REJTWO', action: 'BUY', confidence: 80, fused_score: 80, quality_score: 80, current_price: 200, stop_loss: 190, take_profit: 220 },
    ]);
    await rejectAllocationProposal(proposal._id);
    expect(proposal.status).toBe('REJECTED');
    expect(CREATED_TRADES).toHaveLength(0);
    expect(CREATED_DECISIONS.every(d => d.status === 'REJECTED')).toBe(true);
  });
});

describe('getPendingProposal', () => {
  test('returns null when there is nothing pending', async () => {
    AllocationProposal.findOne = () => ({ sort: () => ({ lean: async () => null }) });
    const pending = await getPendingProposal();
    expect(pending).toBeNull();
  });
});
