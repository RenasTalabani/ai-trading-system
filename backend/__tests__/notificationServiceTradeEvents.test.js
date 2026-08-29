/**
 * Regression suite for BUG-004 (2026-08-29 overnight validation report).
 *
 * Bug: tracing virtualTrackingService.js found no Notification.create() (or
 * any notification of any kind) for trade-open events at all -- a user
 * relying on the in-app notification list to know when the AI opened a
 * position for them would never find out. Separately,
 * sendTradeClosedNotification() was push/Telegram-only and never persisted
 * an in-app Notification document, unlike sendSignalNotification (which
 * always does) -- combined with no Firebase credentials in this local dev
 * environment, a trade closing produced literally no visible notification
 * anywhere.
 *
 * Fixed: sendTradeOpenedNotification() (new) and sendTradeClosedNotification()
 * (extended) both now fan a Notification document out to every active
 * user, via a shared persistTradeEventNotification() helper. Deliberately
 * NOT gated on preferences.fcmEnabled -- that preference controls push
 * delivery, not whether the user can see their own trade history in-app.
 */
const User = require('../src/models/User');
const Notification = require('../src/models/Notification');
const {
  sendTradeOpenedNotification,
  sendTradeClosedNotification,
} = require('../src/services/notificationService');

function usersChain(users) {
  return { select: () => ({ lean: async () => users }) };
}

describe('sendTradeOpenedNotification (BUG-004)', () => {
  test('creates one in-app Notification per active user', async () => {
    User.find = () => usersChain([{ _id: 'u1' }, { _id: 'u2' }]);
    const created = [];
    Notification.create = async (doc) => { created.push(doc); return doc; };

    await sendTradeOpenedNotification({
      _id: 't1', asset: 'BTCUSDT', direction: 'BUY', entryPrice: 65000, sizeUsd: 25,
    });

    expect(created).toHaveLength(2);
    expect(created.map(c => c.userId)).toEqual(['u1', 'u2']);
    expect(created[0].type).toBe('trade_open');
    expect(created[0].data.tradeId).toBe('t1');
    expect(created[0].data.asset).toBe('BTCUSDT');
    expect(created[0].data.action).toBe('BUY');
  });

  test('a Notification.create failure for one user does not stop the others or throw', async () => {
    User.find = () => usersChain([{ _id: 'u1' }, { _id: 'u2' }]);
    let calls = 0;
    Notification.create = async () => { calls++; if (calls === 1) throw new Error('db blip'); return {}; };

    await expect(sendTradeOpenedNotification({
      _id: 't1', asset: 'BTCUSDT', direction: 'BUY', entryPrice: 65000, sizeUsd: 25,
    })).resolves.not.toThrow();

    expect(calls).toBe(2);
  });

  test('no active users is a safe no-op', async () => {
    User.find = () => usersChain([]);
    let called = false;
    Notification.create = async () => { called = true; };

    await sendTradeOpenedNotification({ _id: 't1', asset: 'ETHUSDT', direction: 'SELL', entryPrice: 2400, sizeUsd: 25 });

    expect(called).toBe(false);
  });
});

describe('sendTradeClosedNotification now also persists an in-app Notification (BUG-004)', () => {
  const TRADE = { _id: 't2', asset: 'BTCUSDT', direction: 'BUY', pnl: 12.5, pnlPct: 1.25, exitReason: 'TP', result: 'win' };
  const PORTFOLIO = { currentBalance: 1012.5, winCount: 3, lossCount: 1 };

  beforeEach(() => {
    delete process.env.TELEGRAM_CHANNEL_ID;
  });

  test('a trade close creates a trade_closed Notification for every active user, independent of fcmToken/fcmEnabled', async () => {
    // No fcmToken on either user -- the push fan-out (separate, pre-existing
    // logic) would send nothing, but the in-app record must still be
    // created, since it's not gated on push at all.
    User.find = (query) => {
      // sendTradeClosedNotification's own push-fanout query filters on
      // fcmToken; persistTradeEventNotification's is a plain isActive
      // query -- both hit User.find, so return the right shape either way.
      if (query && query.fcmToken) {
        return { lean: async () => [] };
      }
      return usersChain([{ _id: 'u1' }, { _id: 'u2' }]);
    };
    const created = [];
    Notification.create = async (doc) => { created.push(doc); return doc; };

    await sendTradeClosedNotification(TRADE, PORTFOLIO);

    expect(created).toHaveLength(2);
    expect(created[0].type).toBe('trade_closed');
    expect(created[0].data.tradeId).toBe('t2');
    expect(created[0].data.pnl).toBe(12.5);
    expect(created[0].data.exitReason).toBe('TP');
  });
});
