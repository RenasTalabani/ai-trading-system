/**
 * Regression suite for T-029 (2026-08-18, PM continuous-improvement pass).
 *
 * Two independent bugs found in checkAlerts(), both fixed here:
 *
 * 1. It compared the *whole cached price object* returned by
 *    binanceService.getAllCachedPrices() (`{ asset: { price, ts } }`)
 *    against alert.targetPrice, instead of the numeric `.price` field. An
 *    object compared to a number always evaluates false, so no alert
 *    could ever trigger.
 * 2. It called `sendPushNotification`, a function that has never existed
 *    anywhere in notificationService.js -- destructuring a nonexistent
 *    export silently yields `undefined`, so every triggered alert would
 *    throw "sendPushNotification is not a function" the instant it tried
 *    to notify (caught by the outer try/catch, but only after the alert
 *    had already been marked inactive, so it could never fire again
 *    either). Fixed by using the real `sendPushToUser` export.
 *
 * Together these meant Price Alerts -- the entire purpose of this job --
 * silently never delivered a single notification to any user, ever, with
 * zero error trace visible anywhere, and zero prior test coverage to
 * catch it. All Mongoose models, services, and node-cron are
 * monkey-patched; no real DB, network connection, or live interval used.
 */
const SENT_PUSHES = [];
jest.mock('../src/services/notificationService', () => ({
  sendPushToUser: jest.fn((userId, title, body, data) => {
    SENT_PUSHES.push({ userId, title, body, data });
    return Promise.resolve({ success: true });
  }),
}));

let mockCurrentPrices = {};
jest.mock('../src/services/binanceService', () => ({
  getAllCachedPrices: jest.fn(() => mockCurrentPrices),
}));

// Prevent a real cron timer from being registered -- capture the task
// function instead so tests can invoke a single cycle directly and stay
// deterministic (no waiting on a real */2-minute schedule, no lingering
// interval keeping the test process alive).
jest.mock('node-cron', () => ({ schedule: jest.fn() }));

const PriceAlert = require('../src/models/PriceAlert');
const cron       = require('node-cron');
const { startPriceAlertJob } = require('../src/jobs/priceAlertJob');

function leanResult(result) {
  return { lean: async () => result };
}

let FAKE_ALERTS, UPDATED_ALERTS;

beforeEach(() => {
  mockCurrentPrices = {};
  FAKE_ALERTS = [];
  UPDATED_ALERTS = [];
  SENT_PUSHES.length = 0;

  PriceAlert.find = (query) => leanResult(
    query.active === true ? FAKE_ALERTS.filter(a => a.active) : FAKE_ALERTS
  );
  PriceAlert.findByIdAndUpdate = async (id, update) => {
    UPDATED_ALERTS.push({ id, update });
    return null;
  };
});

async function runCheckAlertsOnce() {
  const taskFn = cron.schedule.mock.calls[cron.schedule.mock.calls.length - 1][1];
  await taskFn();
}

describe('priceAlertJob.checkAlerts', () => {
  beforeAll(() => {
    startPriceAlertJob();
  });

  test('notificationService.sendPushToUser is a real export (regression guard: this file used to import a nonexistent sendPushNotification and the mock alone never would have caught it)', () => {
    const real = jest.requireActual('../src/services/notificationService');
    expect(typeof real.sendPushToUser).toBe('function');
  });

  test('a real object-shaped cached price ({price, ts}) correctly triggers an "above" alert and notifies via sendPushToUser (regression: T-029)', async () => {
    mockCurrentPrices = { BTCUSDT: { price: 71000, ts: Date.now() } };
    FAKE_ALERTS = [{
      _id: 'a1', userId: 'u1', asset: 'BTCUSDT', displayName: 'Bitcoin',
      targetPrice: 70000, direction: 'above', active: true,
    }];

    await runCheckAlertsOnce();

    expect(UPDATED_ALERTS).toHaveLength(1);
    expect(UPDATED_ALERTS[0].update.active).toBe(false);
    expect(SENT_PUSHES).toHaveLength(1);
    expect(SENT_PUSHES[0].userId).toBe('u1');
    expect(SENT_PUSHES[0].title).toContain('Bitcoin');
    expect(SENT_PUSHES[0].data).toEqual({ type: 'price_alert', asset: 'BTCUSDT' });
  });

  test('an object-shaped price that has not crossed the target does not trigger', async () => {
    mockCurrentPrices = { BTCUSDT: { price: 69000, ts: Date.now() } };
    FAKE_ALERTS = [{
      _id: 'a1', userId: 'u1', asset: 'BTCUSDT', displayName: 'Bitcoin',
      targetPrice: 70000, direction: 'above', active: true,
    }];

    await runCheckAlertsOnce();

    expect(UPDATED_ALERTS).toHaveLength(0);
    expect(SENT_PUSHES).toHaveLength(0);
  });

  test('"below" direction still triggers correctly against the real object shape', async () => {
    mockCurrentPrices = { ETHUSDT: { price: 1900, ts: Date.now() } };
    FAKE_ALERTS = [{
      _id: 'a2', userId: 'u2', asset: 'ETHUSDT', displayName: 'Ethereum',
      targetPrice: 2000, direction: 'below', active: true,
    }];

    await runCheckAlertsOnce();

    expect(UPDATED_ALERTS).toHaveLength(1);
    expect(SENT_PUSHES).toHaveLength(1);
    expect(SENT_PUSHES[0].userId).toBe('u2');
  });

  test('an asset missing from the price cache is skipped without crashing', async () => {
    mockCurrentPrices = {};
    FAKE_ALERTS = [{
      _id: 'a1', userId: 'u1', asset: 'BTCUSDT', displayName: 'Bitcoin',
      targetPrice: 70000, direction: 'above', active: true,
    }];

    await expect(runCheckAlertsOnce()).resolves.not.toThrow();
    expect(UPDATED_ALERTS).toHaveLength(0);
  });

  test('a plain-number cache entry (defensive fallback) is still handled correctly', async () => {
    // Not how production actually shapes the cache today, but the fix
    // tolerates a bare number too rather than assuming the object shape.
    mockCurrentPrices = { BTCUSDT: 71000 };
    FAKE_ALERTS = [{
      _id: 'a1', userId: 'u1', asset: 'BTCUSDT', displayName: 'Bitcoin',
      targetPrice: 70000, direction: 'above', active: true,
    }];

    await runCheckAlertsOnce();

    expect(UPDATED_ALERTS).toHaveLength(1);
    expect(SENT_PUSHES).toHaveLength(1);
  });
});
