/**
 * T-082 (2026-08-31): notificationRetryJob.js had zero prior test
 * coverage. Adding focused coverage for retryFailedNotifications() while
 * fixing a dead ternary (`d.status = d.attempts >= MAX_ATTEMPTS ?
 * 'failed' : 'failed'` -- both branches identical) -- confirmed this was
 * always a no-op given the Notification schema's delivery.status enum
 * has no third value to distinguish "still retrying" from "exhausted";
 * simplified to a plain assignment, zero behavior change. Real
 * retry-eligibility is (and always was) gated separately by `attempts`
 * vs MAX_ATTEMPTS, not by this field -- these tests lock that in.
 */
jest.mock('../src/services/firebaseService', () => ({
  sendToDevice: jest.fn(),
  isInvalidTokenError: jest.fn(() => false),
}));
jest.mock('../src/services/notificationService', () => ({
  sendTelegramMessage: jest.fn(),
}));

const { sendToDevice } = require('../src/services/firebaseService');
const { sendTelegramMessage } = require('../src/services/notificationService');
const Notification = require('../src/models/Notification');
const User = require('../src/models/User');

// retryFailedNotifications isn't exported -- reach it via the module's
// cron.schedule callback, same pattern this codebase uses elsewhere for
// jobs that only export their start function.
jest.mock('node-cron', () => ({ schedule: jest.fn() }));
const cron = require('node-cron');
require('../src/jobs/notificationRetryJob').startNotificationRetryJob();
const retryFailedNotifications = cron.schedule.mock.calls[0][1];

function notif(delivery, overrides = {}) {
  return {
    _id: 'n1', title: 'Test', body: 'Body', data: {},
    userId: { _id: 'u1', fcmToken: 'tok1', telegramChatId: null, preferences: {} },
    delivery,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  Notification.updateOne = jest.fn(async () => ({}));
  User.updateOne = jest.fn(async () => ({}));
});

describe('retryFailedNotifications — delivery.status after a failed retry (T-082)', () => {
  test('a failed retry with attempts still below MAX_ATTEMPTS sets status to "failed"', async () => {
    sendToDevice.mockResolvedValue({ success: false, error: 'fcm down' });
    const doc = notif([{ channel: 'fcm', status: 'failed', attempts: 1, lastAttemptAt: new Date(Date.now() - 15 * 60 * 1000) }]);
    Notification.find = () => ({ populate: () => ({ lean: async () => [doc] }) });

    await retryFailedNotifications();

    const [, update] = Notification.updateOne.mock.calls[0];
    expect(update.$set.delivery[0].status).toBe('failed');
    expect(update.$set.delivery[0].attempts).toBe(2);
  });

  test('a failed retry that exhausts MAX_ATTEMPTS also sets status to "failed" (schema has no third state)', async () => {
    sendToDevice.mockResolvedValue({ success: false, error: 'fcm down' });
    // attempts=2 -> becomes 3 == MAX_ATTEMPTS after this failed retry
    const doc = notif([{ channel: 'fcm', status: 'failed', attempts: 2, lastAttemptAt: new Date(Date.now() - 45 * 60 * 1000) }]);
    Notification.find = () => ({ populate: () => ({ lean: async () => [doc] }) });

    await retryFailedNotifications();

    const [, update] = Notification.updateOne.mock.calls[0];
    expect(update.$set.delivery[0].status).toBe('failed');
    expect(update.$set.delivery[0].attempts).toBe(3);
  });

  test('a successful retry sets status to "sent" and stamps sentAt', async () => {
    sendToDevice.mockResolvedValue({ success: true });
    const doc = notif([{ channel: 'fcm', status: 'failed', attempts: 1, lastAttemptAt: new Date(Date.now() - 15 * 60 * 1000) }]);
    Notification.find = () => ({ populate: () => ({ lean: async () => [doc] }) });

    await retryFailedNotifications();

    const [, update] = Notification.updateOne.mock.calls[0];
    expect(update.$set.delivery[0].status).toBe('sent');
    expect(update.$set.delivery[0].sentAt).toBeInstanceOf(Date);
  });

  test('a notification with attempts already at MAX_ATTEMPTS is never queried/retried again', async () => {
    // The real query itself excludes these (`attempts: {$lt: MAX_ATTEMPTS}`)
    // -- simulate that filter directly, matching production behavior.
    Notification.find = jest.fn((query) => {
      expect(query['delivery.attempts'].$lt).toBe(3);
      return { populate: () => ({ lean: async () => [] }) };
    });

    await retryFailedNotifications();

    expect(sendToDevice).not.toHaveBeenCalled();
    expect(Notification.updateOne).not.toHaveBeenCalled();
  });
});
