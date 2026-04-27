const User = require('../models/User');
const logger = require('../config/logger');
const axios = require('axios');

// POST /api/v1/telegram/webhook  — receives updates from Telegram Bot API
exports.handleWebhook = async (req, res) => {
  res.sendStatus(200); // Always acknowledge immediately

  const update = req.body;
  const message = update?.message || update?.my_chat_member;
  if (!message) return;

  const chatId = String(message.chat?.id || '');
  const text   = (message.text || '').trim();

  if (!chatId) return;

  // /start <token>  — link Telegram chat to user account
  if (text.startsWith('/start')) {
    const parts   = text.split(' ');
    const linkToken = parts[1];

    if (!linkToken) {
      await _reply(chatId, '👋 Welcome\\! Send your link token from the app:\n`/start YOUR_LINK_TOKEN`');
      return;
    }

    const user = await User.findOne({ telegramLinkToken: linkToken, telegramLinkExpiry: { $gt: new Date() } });
    if (!user) {
      await _reply(chatId, '❌ Invalid or expired link token\\. Please generate a new one from the app\\.');
      return;
    }

    user.telegramChatId = chatId;
    user.telegramLinkToken = undefined;
    user.telegramLinkExpiry = undefined;
    user.preferences.telegramEnabled = true;
    await user.save();

    await _reply(chatId, `✅ *Telegram notifications enabled\\!*\n\nYou'll now receive AI trading signals here, ${_esc(user.name)}\\.`);
    logger.info(`Telegram linked for user ${user._id} → chatId ${chatId}`);
    return;
  }

  // /stop — unsubscribe
  if (text === '/stop') {
    const user = await User.findOne({ telegramChatId: chatId });
    if (user) {
      user.preferences.telegramEnabled = false;
      await user.save();
      await _reply(chatId, '🔕 Telegram notifications *disabled*\\. Send /start to re\\-enable\\.');
    }
    return;
  }
};

// POST /api/v1/telegram/generate-link  — generate a one-time link token
exports.generateLinkToken = async (req, res, next) => {
  try {
    const { randomUUID } = require('crypto');
    const token  = randomUUID();
    const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    await User.findByIdAndUpdate(req.user._id, {
      telegramLinkToken:  token,
      telegramLinkExpiry: expiry,
    });

    const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'YourTradingBot';

    res.json({
      success:   true,
      token,
      deeplink:  `https://t.me/${botUsername}?start=${token}`,
      expiresAt: expiry,
    });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/v1/telegram/unlink
exports.unlinkTelegram = async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $unset: { telegramChatId: '' },
      'preferences.telegramEnabled': false,
    });
    res.json({ success: true, message: 'Telegram unlinked' });
  } catch (err) {
    next(err);
  }
};

function _esc(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, c => '\\' + c);
}

async function _reply(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id:    chatId,
    text,
    parse_mode: 'MarkdownV2',
  }).catch(err => logger.warn(`Telegram reply failed: ${err.message}`));
}
