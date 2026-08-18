// Verifies incoming Telegram webhook requests against the secret Telegram
// sends back on every call once a webhook is registered with a
// `secret_token` (Telegram's own documented mechanism — see
// https://core.telegram.org/bots/api#setwebhook). Without this, any caller
// could POST a payload shaped like a Telegram update and, for example, make
// the bot relay a message to an arbitrary chat ID (see PROJECT_STATUS.md /
// TASKS.md T-020 for the original finding this closes).
//
// Fails CLOSED: if TELEGRAM_WEBHOOK_SECRET isn't configured on this server,
// every webhook call is rejected rather than silently accepted — there is
// nothing safe to compare against, so "not configured" must not mean
// "unauthenticated access is fine."
const crypto = require('crypto');
const logger = require('../config/logger');

function verifyTelegramWebhook(req, res, next) {
  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const providedSecret = req.headers['x-telegram-bot-api-secret-token'];

  if (!configuredSecret) {
    logger.warn('[Telegram] webhook call rejected — TELEGRAM_WEBHOOK_SECRET is not configured on this server.');
    return res.status(403).json({ success: false, message: 'Telegram webhook is not configured.' });
  }

  if (typeof providedSecret !== 'string' || providedSecret.length === 0) {
    return res.status(403).json({ success: false, message: 'Missing webhook secret.' });
  }

  // Constant-time comparison so a mismatched secret can't be brute-forced
  // via response-timing differences. timingSafeEqual throws on unequal
  // buffer lengths, so a length mismatch is treated as "not equal" first.
  const provided = Buffer.from(providedSecret);
  const expected = Buffer.from(configuredSecret);
  const matches = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);

  if (!matches) {
    return res.status(403).json({ success: false, message: 'Invalid webhook secret.' });
  }

  next();
}

module.exports = { verifyTelegramWebhook };
