/**
 * Regression suite for T-066 (2026-08-29).
 *
 * ai-service's /predict already returns `decision` (T-065's WAIT/AVOID
 * label), but signalJob.js's processAsset() discarded it when building the
 * Signal document -- so even the Guide's fallback path (Signal collection,
 * which the controller's own docstring says is what "makes this screen
 * actually show something most of the time") had no way to surface AVOID,
 * despite the data already being available on the response it already
 * receives. Fixed by persisting `decision: prediction.decision || direction`
 * on Signal.create().
 */
jest.mock('../src/services/aiService');
jest.mock('../src/services/notificationService', () => ({
  sendSignalNotification: jest.fn(async () => {}),
}));
jest.mock('../src/websocket/wsServer', () => ({ broadcastSignal: jest.fn() }));

const aiService = require('../src/services/aiService');
const Signal = require('../src/models/Signal');
const { runSignalGeneration } = require('../src/jobs/signalJob');

function fakePrediction(overrides = {}) {
  return {
    asset: 'BTCUSDT', direction: 'BUY', confidence: 80, raw_confidence: 80,
    entry_price: 65000, stop_loss: 63000, take_profit: 68000,
    reason: 'synthetic', sources: {},
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  Signal.findOne = async () => null; // never a duplicate
});

describe('signalJob.processAsset persists the ai-service decision label (T-066)', () => {
  test('a real AVOID decision from ai-service is persisted on the Signal document', async () => {
    let createdWith = null;
    Signal.create = async (doc) => { createdWith = doc; return { _id: 'sig1', ...doc }; };

    aiService.generatePrediction = jest.fn(async (asset) =>
      asset === 'BTCUSDT' ? fakePrediction({ decision: 'AVOID' }) : null,
    );

    await runSignalGeneration();

    expect(createdWith).not.toBeNull();
    expect(createdWith.direction).toBe('BUY');   // unchanged -- still what approve()/trading reads
    expect(createdWith.decision).toBe('AVOID');  // the new, additive label
  });

  test('an ai-service response missing `decision` (older build) falls back to `direction`, not undefined', async () => {
    let createdWith = null;
    Signal.create = async (doc) => { createdWith = doc; return { _id: 'sig2', ...doc }; };

    aiService.generatePrediction = jest.fn(async (asset) =>
      asset === 'BTCUSDT' ? fakePrediction({ decision: undefined }) : null,
    );

    await runSignalGeneration();

    expect(createdWith.decision).toBe('BUY');
  });

  test('a plain BUY with no risk flag persists decision === direction', async () => {
    let createdWith = null;
    Signal.create = async (doc) => { createdWith = doc; return { _id: 'sig3', ...doc }; };

    aiService.generatePrediction = jest.fn(async (asset) =>
      asset === 'BTCUSDT' ? fakePrediction({ decision: 'BUY' }) : null,
    );

    await runSignalGeneration();

    expect(createdWith.decision).toBe('BUY');
  });
});
