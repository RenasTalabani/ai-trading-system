const express = require('express');
const { protect } = require('../middleware/auth');
const { verifyTelegramWebhook } = require('../middleware/telegramWebhookAuth');
const { handleWebhook, generateLinkToken, unlinkTelegram } = require('../controllers/telegramController');

const router = express.Router();

// Public (no user session) but authenticated via Telegram's own webhook
// secret mechanism — see middleware/telegramWebhookAuth.js.
router.post('/webhook', verifyTelegramWebhook, handleWebhook);

// Protected — app users call these
router.post('/generate-link', protect, generateLinkToken);
router.delete('/unlink',      protect, unlinkTelegram);

module.exports = router;
