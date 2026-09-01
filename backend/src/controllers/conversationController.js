/**
 * RENO Phase 1, step 3 (2026-09-01) — HTTP layer for the conversation
 * feature. Thin: all real logic lives in conversationService.js.
 */
const conversationService = require('../services/conversationService');
const logger = require('../config/logger');

exports.getThread = async (req, res) => {
  try {
    const { thread, messages } = await conversationService.getThread(req.user._id);
    res.json({ success: true, thread, messages });
  } catch (err) {
    logger.error(`[Conversation] getThread failed: ${err.stack}`);
    res.status(500).json({ success: false, message: 'Could not load your conversation right now.' });
  }
};

exports.postMessage = async (req, res) => {
  try {
    const text = (req.body?.text || '').trim();
    if (!text) {
      return res.status(400).json({ success: false, message: 'Message text is required.' });
    }
    if (text.length > 2000) {
      return res.status(400).json({ success: false, message: 'Message is too long (2000 characters max).' });
    }
    const reply = await conversationService.sendMessage(req.user._id, text);
    res.json({ success: true, reply });
  } catch (err) {
    logger.error(`[Conversation] postMessage failed: ${err.stack}`);
    res.status(500).json({ success: false, message: 'Could not send that message right now.' });
  }
};
