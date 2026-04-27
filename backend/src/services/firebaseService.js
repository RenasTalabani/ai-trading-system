const admin = require('firebase-admin');
const logger = require('../config/logger');

let app = null;

function getApp() {
  if (app) return app;

  const projectId     = process.env.FIREBASE_PROJECT_ID;
  const clientEmail   = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey    = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    logger.warn('Firebase credentials not configured — FCM disabled');
    return null;
  }

  try {
    app = admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
    logger.info('Firebase Admin SDK initialized');
  } catch (err) {
    logger.error('Firebase init failed:', err.message);
    app = null;
  }

  return app;
}

/**
 * Send to a single FCM device token.
 * Returns { success, messageId?, error? }
 */
async function sendToDevice(token, title, body, data = {}) {
  if (!getApp()) return { success: false, error: 'Firebase not configured' };

  const message = {
    token,
    notification: { title, body },
    data: Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)])
    ),
    android: {
      priority: 'high',
      notification: { sound: 'default', channelId: 'trading_signals' },
    },
    apns: {
      payload: { aps: { sound: 'default', badge: 1 } },
    },
  };

  try {
    const messageId = await admin.messaging().send(message);
    return { success: true, messageId };
  } catch (err) {
    logger.warn(`FCM send failed for token ...${token.slice(-6)}: ${err.message}`);
    return { success: false, error: err.message, code: err.code };
  }
}

/**
 * Send to multiple tokens (up to 500 per call).
 * Returns { successCount, failureCount, results }
 */
async function sendMulticast(tokens, title, body, data = {}) {
  if (!getApp()) return { successCount: 0, failureCount: tokens.length, results: [] };
  if (!tokens.length)  return { successCount: 0, failureCount: 0, results: [] };

  const stringData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v)])
  );

  const chunks = [];
  for (let i = 0; i < tokens.length; i += 500) chunks.push(tokens.slice(i, i + 500));

  let successCount = 0;
  let failureCount = 0;
  const results = [];

  for (const chunk of chunks) {
    const message = {
      tokens: chunk,
      notification: { title, body },
      data: stringData,
      android: {
        priority: 'high',
        notification: { sound: 'default', channelId: 'trading_signals' },
      },
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    };

    try {
      const resp = await admin.messaging().sendEachForMulticast(message);
      successCount += resp.successCount;
      failureCount += resp.failureCount;
      resp.responses.forEach((r, i) => {
        results.push({
          token: chunk[i],
          success: r.success,
          messageId: r.messageId,
          error: r.error?.message,
          code: r.error?.code,
        });
      });
    } catch (err) {
      logger.error('FCM multicast chunk failed:', err.message);
      failureCount += chunk.length;
      chunk.forEach(token => results.push({ token, success: false, error: err.message }));
    }
  }

  logger.info(`FCM multicast: ${successCount} sent, ${failureCount} failed`);
  return { successCount, failureCount, results };
}

/**
 * True if the FCM error code means the token is permanently invalid.
 */
function isInvalidTokenError(code) {
  return [
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered',
    'messaging/invalid-argument',
  ].includes(code);
}

module.exports = { sendToDevice, sendMulticast, isInvalidTokenError };
