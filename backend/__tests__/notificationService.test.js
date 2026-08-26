/**
 * Regression suite for T-055 (2026-08-26, overnight PM continuous-improvement pass).
 *
 * Bug: sendTradeClosedNotification() pushed an FCM notification to every
 * active user with a stored fcmToken, with NO check of
 * user.preferences.fcmEnabled. Every other broadcast-push code path in this
 * codebase honors that per-user preference before pushing:
 *   - notificationService.sendSignalNotification (fcmTokens filter, line ~220)
 *   - jobs/dailyReportJob.js
 *   - jobs/weeklyReportJob.js
 *   - jobs/globalScanJob.js (_notifyBrainUpdate)
 * sendTradeClosedNotification is fired automatically on every single virtual
 * trade close (checkOpenTrades' TP/SL/liquidation path AND the manual
 * "Sell Now" closePositionNow path in virtualTrackingService.js), so a user
 * who explicitly disabled push notifications kept getting pushed to on every
 * trade close anyway -- their preference was silently ignored on this one
 * path only.
 *
 * Fix: filter the eligible-user list by `preferences?.fcmEnabled !== false`
 * before building the FCM token list, matching the established convention
 * used everywhere else in the codebase.
 */
jest.mock('../src/services/firebaseService', () => ({
  sendMulticast: jest.fn(() => Promise.resolve({ successCount: 0, failureCount: 0, results: [] })),
  sendToDevice: jest.fn(() => Promise.resolve({ success: true })),
  isInvalidTokenError: jest.fn(() => false),
}));

const User = require('../src/models/User');
const firebaseService = require('../src/services/firebaseService');
const { sendTradeClosedNotification } = require('../src/services/notificationService');

const TRADE = { asset: 'BTCUSDT', direction: 'BUY', pnl: 12.5, pnlPct: 1.25, exitReason: 'TP', result: 'win' };
const PORTFOLIO = { currentBalance: 1012.5, winCount: 3, lossCount: 1 };

describe('notificationService.sendTradeClosedNotification — honors fcmEnabled (T-055)', () => {
  const ORIGINAL_CHANNEL = process.env.TELEGRAM_CHANNEL_ID;

  beforeEach(() => {
    delete process.env.TELEGRAM_CHANNEL_ID; // keep the Telegram admin-broadcast branch out of scope for this suite
    firebaseService.sendMulticast.mockClear();
  });

  afterAll(() => {
    if (ORIGINAL_CHANNEL !== undefined) process.env.TELEGRAM_CHANNEL_ID = ORIGINAL_CHANNEL;
  });

  test('regression: a user who disabled push (fcmEnabled:false) is excluded from the multicast', async () => {
    User.find = () => ({
      lean: async () => ([
        { _id: 'u1', fcmToken: 'tokenA', preferences: { fcmEnabled: true } },
        { _id: 'u2', fcmToken: 'tokenB', preferences: { fcmEnabled: false } }, // opted out
        { _id: 'u3', fcmToken: 'tokenC', preferences: {} },
      ]),
    });

    await sendTradeClosedNotification(TRADE, PORTFOLIO);

    expect(firebaseService.sendMulticast).toHaveBeenCalledTimes(1);
    const tokensArg = firebaseService.sendMulticast.mock.calls[0][0];
    expect(tokensArg).toEqual(expect.arrayContaining(['tokenA', 'tokenC']));
    expect(tokensArg).not.toContain('tokenB');
  });

  test('everyone opted out → sendMulticast is not called at all', async () => {
    User.find = () => ({
      lean: async () => ([
        { _id: 'u1', fcmToken: 'tokenA', preferences: { fcmEnabled: false } },
      ]),
    });

    await sendTradeClosedNotification(TRADE, PORTFOLIO);

    expect(firebaseService.sendMulticast).not.toHaveBeenCalled();
  });

  test('default preferences (no fcmEnabled key present) still receive the push', async () => {
    User.find = () => ({
      lean: async () => ([
        { _id: 'u1', fcmToken: 'tokenA' }, // no preferences object at all
      ]),
    });

    await sendTradeClosedNotification(TRADE, PORTFOLIO);

    expect(firebaseService.sendMulticast).toHaveBeenCalledTimes(1);
    expect(firebaseService.sendMulticast.mock.calls[0][0]).toEqual(['tokenA']);
  });

  test('users without an fcmToken never reach the eligible-token list', async () => {
    User.find = () => ({
      lean: async () => ([
        { _id: 'u1', preferences: { fcmEnabled: true } }, // no fcmToken field
      ]),
    });

    await sendTradeClosedNotification(TRADE, PORTFOLIO);

    expect(firebaseService.sendMulticast).not.toHaveBeenCalled();
  });
});
