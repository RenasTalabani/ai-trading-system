const express = require('express');
const { protect } = require('../middleware/auth');
const { handleWebhook, generateLinkToken, unlinkTelegram } = require('../controllers/telegramController');

const router = express.Router();

// Public — Telegram calls this
router.post('/webhook', handleWebhook);

// Protected — app users call these
router.post('/generate-link', protect, generateLinkToken);
router.delete('/unlink',      protect, unlinkTelegram);

module.exports = router;
