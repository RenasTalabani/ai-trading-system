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

// Phase 2, step 1 (2026-09-01) — approve a trade plan from a chat "Approve"
// tap. Deliberately takes NO trade PARAMETERS (asset/entry/stop/target/
// amount) from req.body — see conversationService.approvePlan()'s own
// comment for why (T-071 parity). asset/action below are the one exception,
// added 2026-09-04: identity-only, used solely to confirm the plan hasn't
// changed since the client displayed it (see approvePlan()'s own comment).
exports.approvePlan = async (req, res) => {
  try {
    const { asset, action } = req.body || {};
    const result = await conversationService.approvePlan(req.user._id, asset, action);
    if (!result.success) {
      return res.status(409).json({
        success: false,
        staleApproval: !!result.staleApproval,
        message: result.message,
        reply: result.reply,
      });
    }
    res.json({ success: true, trade: result.trade, reply: result.reply });
  } catch (err) {
    logger.error(`[Conversation] approvePlan failed: ${err.stack}`);
    res.status(500).json({ success: false, message: 'Could not approve that right now.' });
  }
};
