/**
 * AUDIT-02 (2026-09-01, production audit): RENO-001 (ai-service,
 * global_analyzer.py, applied in this same audit pass) stopped hard-
 * excluding candidates below the real confidence/fused-score bar from
 * `scored`/`best`/`top_opportunities` -- every non-junk, non-macro-blocked
 * candidate is now ranked and returned, each carrying an honest
 * `meets_bar` boolean. That means `cached.result.best` is now non-null
 * almost every scan, REGARDLESS of whether it actually clears the real
 * quality bar.
 *
 * Found during this same audit, before anything was deployed: five
 * separate backend call sites treated "best is non-null" as "there is a
 * confirmed, qualifying pick" and had no `meets_bar` awareness --
 * including globalScanJob.js, which runs unattended every 30 minutes and
 * would have pushed a "AI Brain — BUY <asset>" notification to every
 * FCM-enabled user for a non-qualifying candidate on essentially every
 * cycle, and hourlyReportJob.js, doing the same hourly. This suite locks
 * in the fix across all five: brainController.actionReport(),
 * brainController._buildAnswer() ('action'/'picks' and 'risk' intents),
 * coreController.advice(), guideController.resolveSuggestion(), and
 * globalScanJob.runGlobalScan()'s notify/store gate.
 */
jest.mock('../src/jobs/globalScanJob', () => ({ getCache: jest.fn() }));

const { getCache: getGlobalCache } = require('../src/jobs/globalScanJob');
const AIDecision = require('../src/models/AIDecision');
const NewsData   = require('../src/models/NewsData');
const VirtualTrade = require('../src/models/VirtualTrade');
const Signal     = require('../src/models/Signal');
const brainController = require('../src/controllers/brainController');
const coreController  = require('../src/controllers/coreController');
const guideController = require('../src/controllers/guideController');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json   = jest.fn(() => res);
  return res;
}

function chainReturning(value) {
  return { sort: () => ({ limit: () => ({ lean: async () => value }) }) };
}

function belowBarBest(overrides = {}) {
  return {
    asset: 'DOGEUSDT', display_name: 'Dogecoin', action: 'BUY',
    confidence: 42, fused_score: 38, current_price: 0.08,
    reason: 'weak signal', meets_bar: false,
    ...overrides,
  };
}

function qualifyingBest(overrides = {}) {
  return {
    asset: 'BTCUSDT', display_name: 'Bitcoin', action: 'BUY',
    confidence: 82, fused_score: 78, current_price: 65000,
    reason: 'strong signal', meets_bar: true,
    ...overrides,
  };
}

const topOpportunities = [
  belowBarBest({ asset: 'DOGEUSDT', confidence: 42 }),
  belowBarBest({ asset: 'ADAUSDT', confidence: 40 }),
];

describe('brainController.actionReport — below-bar best is treated as no confirmed pick', () => {
  beforeEach(() => {
    AIDecision.countDocuments = jest.fn(async () => 0);
  });

  test('meets_bar: false -> honest no-recommendation response with a watch list, not the below-bar candidate presented as confirmed', async () => {
    getGlobalCache.mockReturnValue({
      result: { success: true, best: belowBarBest(), top_opportunities: topOpportunities },
      scannedAt: new Date(),
    });
    const res = mockRes();

    await brainController.actionReport({}, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.action.bestAsset).toBe('');
    expect(payload.action.confidence).toBe(0);
    expect(payload.action.reason).toMatch(/no strong recommendation/i);
    expect(payload.watchList).toBeDefined();
    expect(payload.watchList.length).toBe(2);
    expect(payload.watchList[0].meetsBar).toBe(false);
    expect(payload.watchList[0].asset).toBe('DOGEUSDT');
  });

  test('meets_bar: true -> the real qualifying pick is still presented normally (regression check)', async () => {
    getGlobalCache.mockReturnValue({
      result: { success: true, best: qualifyingBest(), top_opportunities: [] },
      scannedAt: new Date(),
    });
    const res = mockRes();

    await brainController.actionReport({}, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.action.bestAsset).toBe('BTCUSDT');
    expect(payload.action.confidence).toBe(82);
    expect(payload.watchList).toBeUndefined();
  });

  test('a best from an older ai-service deploy with no meets_bar field at all stays trusted (backward compat)', async () => {
    const { meets_bar, ...noField } = qualifyingBest();
    getGlobalCache.mockReturnValue({
      result: { success: true, best: noField, top_opportunities: [] },
      scannedAt: new Date(),
    });
    const res = mockRes();

    await brainController.actionReport({}, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.action.bestAsset).toBe('BTCUSDT');
  });
});

describe('brainController._buildAnswer via askBrain — same guard for chat intents', () => {
  beforeEach(() => {
    AIDecision.find = jest.fn(() => chainReturning([]));
    AIDecision.countDocuments = jest.fn(async () => 0);
    AIDecision.aggregate = jest.fn(async () => []);
    NewsData.find = jest.fn(() => chainReturning([]));
  });

  test('"top picks" with a below-bar best gets the no-recommendation text, not a confident BUY call', async () => {
    getGlobalCache.mockReturnValue({
      result: { success: true, best: belowBarBest(), top_opportunities: [] },
      scannedAt: new Date(),
    });
    const res = mockRes();

    await brainController.askBrain({ body: { question: 'top picks?' } }, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.text).toMatch(/no strong recommendation/i);
  });

  test('"risk levels" with a below-bar best does not present concrete SL/TP as a confirmed trade', async () => {
    getGlobalCache.mockReturnValue({
      result: { success: true, best: belowBarBest({ stop_loss: 0.07, take_profit: 0.09 }), top_opportunities: [] },
      scannedAt: new Date(),
    });
    const res = mockRes();

    await brainController.askBrain({ body: { question: 'what are the risk levels?' } }, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.text).toMatch(/no confirmed high-quality trade/i);
    expect(payload.text).not.toContain('0.07');
  });
});

describe('coreController.advice — same guard', () => {
  test('below-bar best returns advice: null with a watch_list, not the candidate as confirmed advice', async () => {
    getGlobalCache.mockReturnValue({
      result: { success: true, best: belowBarBest(), top_opportunities: topOpportunities },
      scannedAt: new Date(),
    });
    const res = mockRes();

    await coreController.advice({}, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.advice).toBeNull();
    expect(payload.watch_list.length).toBe(2);
    expect(payload.watch_list[0].meets_bar).toBe(false);
  });
});

describe('guideController.resolveSuggestion — falls back to the Signal pipeline when best is below-bar', () => {
  test('a below-bar global-scan best does NOT become Guide\'s suggestion; falls through to the Signal pipeline', async () => {
    getGlobalCache.mockReturnValue({
      result: { success: true, best: belowBarBest(), timeframe: '1h' },
      scannedAt: new Date(),
    });
    VirtualTrade.distinct = jest.fn(async () => []);
    Signal.findOne = jest.fn()
      .mockReturnValueOnce({ sort: () => Promise.resolve(null) })       // preferred window: nothing
      .mockReturnValueOnce({ sort: () => Promise.resolve(null) });      // fallback window: nothing too -> null suggestion

    const suggestion = await guideController.resolveSuggestion();

    // The below-bar DOGEUSDT candidate must never surface as the suggestion.
    expect(suggestion?.asset).not.toBe('DOGEUSDT');
  });

  test('a qualifying (meets_bar: true) global-scan best is still used directly (regression check)', async () => {
    getGlobalCache.mockReturnValue({
      result: { success: true, best: qualifyingBest(), timeframe: '1h' },
      scannedAt: new Date(),
    });
    VirtualTrade.distinct = jest.fn(async () => []);

    const suggestion = await guideController.resolveSuggestion();

    expect(suggestion.asset).toBe('BTCUSDT');
    expect(suggestion.confidence).toBe(82);
  });
});

describe('globalScanJob.runGlobalScan — notify/store gate for below-bar candidates', () => {
  // This job runs unattended every 30 minutes and is the highest-stakes of
  // the five fixes: without the meets_bar guard it would push a
  // "AI Brain — BUY <asset>" notification to every FCM-enabled user, and
  // permanently record a non-qualifying candidate into the AIDecision
  // collection the Portfolio "if you followed every AI decision" balance
  // replays (T-085), for essentially every below-bar candidate.
  //
  // Each test loads a fresh copy of the module (jest.resetModules +
  // jest.doMock) so the module-level `_lastBest` change-detection state
  // never leaks between cases -- every test therefore starts from a clean
  // "no prior best" state, where a qualifying pick is always a "change".
  function loadFreshGlobalScanJob(scanResponseData) {
    jest.resetModules();
    jest.doMock('axios', () => ({ post: jest.fn(async () => ({ data: scanResponseData })) }));
    const storeGlobalDecision = jest.fn(async () => {});
    jest.doMock('../src/jobs/decisionTrackingJob', () => ({ storeGlobalDecision }));
    const sendPushToUser = jest.fn(async () => {});
    jest.doMock('../src/services/notificationService', () => ({ sendPushToUser }));
    const find = jest.fn(() => ({ lean: async () => [{ _id: 'u1', preferences: {}, fcmToken: 'tok' }] }));
    jest.doMock('../src/models/User', () => ({ find }));

    // The top-level `jest.mock('../src/jobs/globalScanJob', ...)` in this
    // file (used by the controller-level describe blocks above, which only
    // need its `getCache`) persists across jest.resetModules() -- a plain
    // `require` here would still return that stub with no `runGlobalScan`.
    // jest.requireActual bypasses the mock registry to get the real module.
    const globalScanJob = jest.requireActual('../src/jobs/globalScanJob');
    return { globalScanJob, storeGlobalDecision, sendPushToUser };
  }

  afterEach(() => {
    jest.resetModules();
    jest.dontMock('axios');
    jest.dontMock('../src/jobs/decisionTrackingJob');
    jest.dontMock('../src/services/notificationService');
    jest.dontMock('../src/models/User');
  });

  test('meets_bar: false -> neither stores the decision nor sends a push notification', async () => {
    const { globalScanJob, storeGlobalDecision, sendPushToUser } = loadFreshGlobalScanJob({
      success: true, best: belowBarBest(),
    });

    await globalScanJob.runGlobalScan();

    expect(storeGlobalDecision).not.toHaveBeenCalled();
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  test('meets_bar: true -> stores the decision and sends a push notification (regression check)', async () => {
    const { globalScanJob, storeGlobalDecision, sendPushToUser } = loadFreshGlobalScanJob({
      success: true, best: qualifyingBest(),
    });

    await globalScanJob.runGlobalScan();

    expect(storeGlobalDecision).toHaveBeenCalledTimes(1);
    expect(storeGlobalDecision.mock.calls[0][0].asset).toBe('BTCUSDT');
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
  });

  test('a best from an older ai-service deploy with no meets_bar field at all stays trusted (backward compat)', async () => {
    const { meets_bar, ...noField } = qualifyingBest();
    const { globalScanJob, storeGlobalDecision, sendPushToUser } = loadFreshGlobalScanJob({
      success: true, best: noField,
    });

    await globalScanJob.runGlobalScan();

    expect(storeGlobalDecision).toHaveBeenCalledTimes(1);
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
  });
});
