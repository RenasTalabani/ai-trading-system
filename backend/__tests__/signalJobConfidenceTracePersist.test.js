/**
 * Regression suite for T-078 (2026-08-31).
 *
 * ai-service's /predict now returns `confidence_trace` (an audit trail of
 * each sequential confidence-adjustment stage: event override, regime
 * modifier, multi-timeframe confirmation, funding-rate contrarian bias),
 * but signalJob.js's processAsset() was discarding it when building the
 * Signal document, same class of gap T-066 fixed for `decision`. Fixed by
 * persisting `confidenceTrace: prediction.confidence_trace` on
 * Signal.create() -- closes the gap that stopped a real overnight audit
 * from re-deriving why a stored signal's confidence landed on a
 * suspiciously round number (exactly 100) after the fact.
 */
jest.mock('../src/services/aiService');
jest.mock('../src/services/notificationService', () => ({
  sendSignalNotification: jest.fn(async () => {}),
}));
jest.mock('../src/websocket/wsServer', () => ({ broadcastSignal: jest.fn() }));

const aiService = require('../src/services/aiService');
const Signal = require('../src/models/Signal');
const { runSignalGeneration } = require('../src/jobs/signalJob');

const FAKE_TRACE = {
  fusion_confidence: 78.0,
  after_event_override: 88.0,
  after_regime_adjustment: 92.4,
  after_mtf_confirmation: 97.4,
  after_funding_bias: 100.0,
  regime: 'TRENDING',
  regime_modifier: 1.05,
  mtf_trend_alignment: 'bullish',
  mtf_agrees: true,
  mtf_fights: false,
  funding_rate: null,
  funding_against: false,
  calibrated: false,
};

function fakePrediction(overrides = {}) {
  return {
    asset: 'BTCUSDT', direction: 'BUY', confidence: 80, raw_confidence: 80,
    entry_price: 65000, stop_loss: 63000, take_profit: 68000,
    reason: 'synthetic', sources: {}, confidence_trace: FAKE_TRACE,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  Signal.findOne = async () => null; // never a duplicate
});

describe('signalJob.processAsset persists the ai-service confidence_trace (T-078)', () => {
  test('a real confidence_trace from ai-service is persisted on the Signal document', async () => {
    let createdWith = null;
    Signal.create = async (doc) => { createdWith = doc; return { _id: 'sig1', ...doc }; };

    aiService.generatePrediction = jest.fn(async (asset) =>
      asset === 'BTCUSDT' ? fakePrediction() : null,
    );

    await runSignalGeneration();

    expect(createdWith).not.toBeNull();
    expect(createdWith.confidenceTrace).toEqual(FAKE_TRACE);
    // Unaffected by the new field -- same as before
    expect(createdWith.direction).toBe('BUY');
    expect(createdWith.confidence).toBe(80);
  });

  test('an ai-service response missing confidence_trace (older build) persists undefined, not a crash', async () => {
    let createdWith = null;
    Signal.create = async (doc) => { createdWith = doc; return { _id: 'sig2', ...doc }; };

    aiService.generatePrediction = jest.fn(async (asset) =>
      asset === 'BTCUSDT' ? fakePrediction({ confidence_trace: undefined }) : null,
    );

    await runSignalGeneration();

    expect(createdWith).not.toBeNull();
    expect(createdWith.confidenceTrace).toBeUndefined();
  });
});
