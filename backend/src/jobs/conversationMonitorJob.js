/**
 * conversationMonitorJob — Phase 2, step 2 (2026-09-01), upgraded to the
 * 4-state RENO recommendation model in Phase 3, step 3 (RENO-012).
 *
 * Continuous position monitoring for RENO chat: polls open (paper) trades
 * on a timer and posts a proactive ConversationMessage when something
 * worth telling the user actually changed — a recommendation change to
 * EXIT, TAKE_PROFIT, or EXTEND (via renoRecommendationService.js's
 * buildRenoRecommendation()), data going unavailable, or a real close
 * (TP/SL/manual/etc.) with real P&L. Nothing here is invented: every
 * number comes straight from buildPositionGuidance() /
 * buildRenoRecommendation() (both already independently tested) or
 * straight off the closed VirtualTrade document itself.
 *
 * Deliberately NOT hooked into virtualTrackingService.js's existing
 * close-processing hot path (processTrade/checkAndCloseTrade etc.) —
 * that file is heavily tested and financially load-bearing, and wiring a
 * new feature into its hot path risks it and creates a circular
 * dependency (virtualTrackingService -> conversationService ->
 * guideController -> virtualTrackingService). Instead this is a
 * completely separate, standalone poller, mirroring globalScanJob.js's
 * own "cron.schedule + in-memory last-state Map" shape — read-only
 * against VirtualTrade, writes only new ConversationMessage documents
 * and appends changeEvents onto a trade's TradeThesis (never rewrites
 * the original approved plan — see TradeThesis.js's own header).
 *
 * Scoping: this app runs a single, global paper-trading portfolio (no
 * userId on VirtualTrade — confirmed by reading the schema) but
 * conversations are per-user (ConversationThread.userId). A proactive
 * update for a given trade is posted only into threads that have
 * actually discussed that trade before (ConversationMessage.relatedTradeIds
 * contains it — set whenever get_open_positions/get_suggestion/
 * approvePlan surfaced it) — never a blind broadcast to every thread,
 * and never posted at all if no thread has ever referenced that trade.
 *
 * Real-vs-hypothetical discipline: EXIT/TAKE_PROFIT/EXTEND alerts
 * describe an OPEN position's unrealized P&L, and the message text says
 * so explicitly ("paper P&L, not yet realized"). Close notifications
 * only ever use the trade's own persisted pnl/pnlPct/result fields, set
 * for real by virtualTrackingService's actual close logic — never
 * computed or guessed here.
 *
 * "Never convert missing data into HOLD": INSUFFICIENT_DATA is its own
 * tracked state, and a transition INTO it (from a previously-known
 * state) gets its own honest, one-time notification rather than either
 * silence or a fabricated HOLD.
 */
const cron   = require('node-cron');
const logger = require('../config/logger');

const VirtualTrade         = require('../models/VirtualTrade');
const Signal                = require('../models/Signal');
const ConversationThread   = require('../models/ConversationThread');
const ConversationMessage  = require('../models/ConversationMessage');
const TradeThesis           = require('../models/TradeThesis');
const { getAllCachedPrices, TRACKED_ASSETS, getSymbolStatus } = require('../services/binanceService');
const aiService = require('../services/aiService');
const { buildPositionGuidance } = require('../controllers/guideController');
const { buildRenoRecommendation } = require('../services/renoRecommendationService');

const EXTENDED_PRICE_ASSETS = ['XAUUSD']; // mirrors guideController.js's own list

// States that are worth a proactive nudge the moment a trade first
// enters them (from a different, previously-known state). Settling
// into or staying in plain HOLD is never itself a notification trigger
// — that's "nothing material changed," the whole point of state-gating.
const NOTIFY_ON_ENTRY_TO = new Set(['EXIT', 'TAKE_PROFIT', 'EXTEND', 'INSUFFICIENT_DATA']);

// tradeId (string) -> last-known RENO recommendation state while the
// trade was open. In-memory only, same convention as globalScanJob.js's
// _lastBest — a restart just means the next cycle can't detect a change
// until the one after that, which is an acceptable, honestly-documented
// gap for a "nice to have proactively" feature, not a safety-critical one.
let _lastState = new Map();

async function _pricesAndSignalsFor(openTrades) {
  const prices = getAllCachedPrices();
  for (const asset of EXTENDED_PRICE_ASSETS) {
    const price = await aiService.getPrice(asset);
    if (price !== null) prices[asset] = { price };
  }
  const assets = [...new Set(openTrades.map(t => t.asset))];
  const recentSignals = await Signal.find({ asset: { $in: assets } }).sort({ createdAt: -1 });
  const latestByAsset = {};
  for (const s of recentSignals) {
    if (!latestByAsset[s.asset]) latestByAsset[s.asset] = s;
  }
  return { prices, latestByAsset };
}

async function _guidanceFor(trade, prices, latestByAsset) {
  const cached = prices[trade.asset];
  if (cached) {
    const currentPrice = typeof cached === 'object' ? cached.price : cached;
    return buildPositionGuidance(trade, currentPrice, latestByAsset[trade.asset]);
  }
  if (TRACKED_ASSETS.includes(trade.asset)) {
    const status = await getSymbolStatus(trade.asset);
    if (status && status !== 'TRADING') {
      return buildPositionGuidance(trade, null, latestByAsset[trade.asset], true);
    }
  }
  // Same honest "unknown/transient gap" fallback getPositions() uses.
  return buildPositionGuidance(trade, trade.entryPrice, latestByAsset[trade.asset]);
}

// Only threads that have actually discussed this trade before — see the
// "Scoping" note in the header comment for why this never broadcasts blind.
async function _threadsLinkedToTrade(tradeId) {
  return ConversationMessage.find({ relatedTradeIds: tradeId }).distinct('threadId');
}

async function _postToThreads(threadIds, content, proactiveTrigger, relatedTradeIds) {
  for (const threadId of threadIds) {
    const msg = await ConversationMessage.create({
      threadId,
      role: 'assistant',
      content,
      proactiveTrigger,
      relatedTradeIds,
    });
    await ConversationThread.updateOne({ _id: threadId }, {
      lastMessageAt: msg.createdAt,
      lastMessagePreview: content.slice(0, 140),
    });
  }
}

// Best-effort append to the trade's TradeThesis, if one exists (only
// RENO-chat-approved trades have one — see TradeThesis.js's scope note).
// Never overwrites the original plan; a missing thesis or a write
// failure here is logged and swallowed, same convention as the
// fire-and-forget push notification in virtualTrackingService.js.
async function _recordChangeEvent(tradeId, previousState, newState, reason, evidence) {
  try {
    const thesis = await TradeThesis.findOne({ tradeId });
    if (!thesis) return;
    thesis.changeEvents.push({ previousState, newState, reason, evidence });
    await thesis.save();
  } catch (err) {
    logger.warn(`[ConversationMonitor] Failed to record change event for trade ${tradeId}: ${err.message}`);
  }
}

function _messageForState(trade, renoRec) {
  const pnl = renoRec.evidence?.pnlPct;
  const pnlText = typeof pnl === 'number' ? ` It's currently at ${pnl >= 0 ? '+' : ''}${pnl}% (paper P&L, not yet realized).` : '';

  switch (renoRec.state) {
    case 'EXIT':
      return `Update on your ${trade.asset} ${trade.direction} position: I'd consider closing it now — ${renoRec.reason}${pnlText}`;
    case 'TAKE_PROFIT':
      return `Update on your ${trade.asset} ${trade.direction} position: ${renoRec.reason}${pnlText}`;
    case 'EXTEND':
      return `Update on your ${trade.asset} ${trade.direction} position: ${renoRec.reason}${pnlText}`;
    case 'INSUFFICIENT_DATA':
      return `Heads up on your ${trade.asset} ${trade.direction} position: ${renoRec.reason} I can't give you fresh guidance on it until that's back.`;
    default:
      return `Update on your ${trade.asset} ${trade.direction} position: ${renoRec.reason}${pnlText}`;
  }
}

const TRIGGER_FOR_STATE = {
  EXIT: 'recommendation_exit',
  TAKE_PROFIT: 'recommendation_take_profit',
  EXTEND: 'recommendation_extend',
  INSUFFICIENT_DATA: 'data_unavailable',
};

async function runConversationMonitor() {
  try {
    const openTrades = await VirtualTrade.find({ status: 'open' });
    const openIds = new Set(openTrades.map(t => String(t._id)));

    // 1. Recommendation-state changes on positions still open.
    if (openTrades.length > 0) {
      const { prices, latestByAsset } = await _pricesAndSignalsFor(openTrades);

      for (const trade of openTrades) {
        const guidance = await _guidanceFor(trade, prices, latestByAsset);
        const latestSignal = latestByAsset[trade.asset] || null;
        const renoRec = buildRenoRecommendation(trade, guidance, latestSignal);

        const tid = String(trade._id);
        const prevState = _lastState.get(tid);
        _lastState.set(tid, renoRec.state);

        const enteredNotifiableState = prevState && prevState !== renoRec.state && NOTIFY_ON_ENTRY_TO.has(renoRec.state);
        if (enteredNotifiableState) {
          const threadIds = await _threadsLinkedToTrade(trade._id);
          if (threadIds.length > 0) {
            const content = _messageForState(trade, renoRec);
            const trigger = TRIGGER_FOR_STATE[renoRec.state] || 'recommendation_change';
            await _postToThreads(threadIds, content, trigger, [trade._id]);
            logger.info(`[ConversationMonitor] ${renoRec.state} alert — ${trade.asset}, posted to ${threadIds.length} thread(s)`);
          }
          // Record the change event on the trade's thesis regardless of
          // whether any thread was notified — this is the durable record;
          // the chat message is just the notification of it.
          await _recordChangeEvent(trade._id, prevState, renoRec.state, renoRec.reason, renoRec.evidence);
        }
      }
    }

    // 2. Trades that were open last cycle and are gone now — a real close.
    for (const tid of Array.from(_lastState.keys())) {
      if (openIds.has(tid)) continue;
      const prevState = _lastState.get(tid);
      _lastState.delete(tid);

      const trade = await VirtualTrade.findById(tid).lean();
      if (!trade || trade.status === 'open') continue; // deleted or reopened under a new doc — nothing honest to report

      const threadIds = await _threadsLinkedToTrade(tid);

      const outcomeText = trade.result === 'win' ? 'closed in profit'
        : trade.result === 'loss' ? 'closed at a loss'
        : 'closed';
      const pnlText = typeof trade.pnl === 'number'
        ? `$${trade.pnl.toFixed(2)} (${trade.pnlPct >= 0 ? '+' : ''}${trade.pnlPct}%)`
        : 'an amount I don\'t have a record of';
      const reasonText = trade.exitReason ? ` Exit reason: ${trade.exitReason}.` : '';
      const content = `Your ${trade.asset} ${trade.direction} position just ${outcomeText} — real paper P&L: ${pnlText}.${reasonText}`;

      if (threadIds.length > 0) {
        await _postToThreads(threadIds, content, 'position_closed', [trade._id]);
        logger.info(`[ConversationMonitor] Close notification — ${trade.asset} ${trade.result || 'closed'}, posted to ${threadIds.length} thread(s)`);
      }

      // Final changeEvent on the thesis, real numbers only, regardless of
      // whether any thread was notified — completes the thesis's record.
      await _recordChangeEvent(tid, prevState ?? null, 'CLOSED', `Trade ${outcomeText}.${reasonText}`, {
        pnl: trade.pnl ?? null, pnlPct: trade.pnlPct ?? null, exitReason: trade.exitReason ?? null, result: trade.result ?? null,
      });
    }
  } catch (err) {
    logger.warn(`[ConversationMonitor] cycle failed: ${err.message}`);
  }
}

function start() {
  // Run once immediately to warm _lastState (no alerts fire on this
  // first pass — prevState is undefined for everything), then every
  // 5 minutes, same rhythm as trackerEvalJob/priceAlertJob's polling cadence.
  runConversationMonitor();
  cron.schedule('*/5 * * * *', runConversationMonitor);
  logger.info('[ConversationMonitor] Scheduled — runs every 5 minutes');
}

module.exports = { start, runConversationMonitor, _resetStateForTests: () => { _lastState = new Map(); } };
