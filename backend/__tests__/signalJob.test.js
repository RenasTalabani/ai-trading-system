/**
 * Regression suite for T-030 (2026-08-18, PM continuous-improvement pass).
 *
 * expireOldSignals() is registered directly as an hourly cron.schedule()
 * callback but had no try/catch of its own -- a per-function gap in the
 * same class T-024 closed for notificationRetryJob.js (that earlier pass
 * checked try/catch presence per *file*, not per scheduled function, so
 * this one slipped through since signalJob.js has a try/catch elsewhere,
 * in processAsset). node-cron catches an async task's rejection
 * internally so this was never a crash risk, but with nothing listening
 * for its 'task-failed' event, a Signal.updateMany failure would vanish
 * with zero log trace. This suite proves expireOldSignals() now survives
 * that failure instead of letting it escape uncaught.
 */
const Signal = require('../src/models/Signal');
const { expireOldSignals } = require('../src/jobs/signalJob');

describe('signalJob.expireOldSignals', () => {
  test('a Signal.updateMany failure is caught, not left to escape uncaught (regression: T-030)', async () => {
    Signal.updateMany = async () => { throw new Error('DB blip'); };

    await expect(expireOldSignals()).resolves.not.toThrow();
  });

  test('a successful run still expires old signals normally', async () => {
    let calledWith = null;
    Signal.updateMany = async (query, update) => {
      calledWith = { query, update };
      return { modifiedCount: 3 };
    };

    await expireOldSignals();

    expect(calledWith.query.status).toBe('active');
    expect(calledWith.update.$set.status).toBe('expired');
  });

  test('zero matching signals is a normal no-op, not an error', async () => {
    Signal.updateMany = async () => ({ modifiedCount: 0 });

    await expect(expireOldSignals()).resolves.not.toThrow();
  });
});
