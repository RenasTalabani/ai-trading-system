/**
 * conversationMonitorJob — Phase 2, step 2 (2026-09-01).
 *
 * Continuous position monitoring for RENO chat: polls open (paper) trades
 * on a timer and posts a proactive ConversationMessage when something
 * worth telling the user actually changed — a recommendation flip to
 * SELL, or a real close (TP/SL/manual/etc.) with real P&L. Nothing here
 * is invented: every number comes straight from buildPositionGuidance()
 * (the same, already-tested function Guide's screen and RENO chat's own
 * get_open_positions tool both use) or straight off the closed
 * VirtualTrade document itself.
 *
 * Deliberately NOT hooked into virtualTrackingService.js's existing
 * close-processing hot path (processTrade/checkAndCloseTrade etc.) —
 * that file is heavily tested and financially load-bearing, and wiring a
 * new feature into its hot path risks it and creates a circular
 * dependency (virtualTrackingService -> conversationService ->
 * guideController -> virtualTrackingService). Instead this is a
 * completely separate, standalone poller, mirroring globalScanJob.js's
 * own "cron.schedule + in-memory last-state Map" shape — read-only
 * against VirtualTrade, writes only new ConversationMessage documents.
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
 * Real-vs-hypothetical discipline: flip alerts describe an OPEN
 * position's unrealized P&L, and the message text says so explicitly
 * ("paper P&L, not yet realized"). Close notifications only ever use the
 * trade's own persisted pnl/pnlPct/result fields, set for real by
 * virtualTrackingService's actual close logic — never computed or
 * guessed here.
 */
const cron   = require('node-cron');
const logger = require('../config/logger');

const VirtualTrade        = require('../models/VirtualTrade');
const Signal               = require('../models/Signal');
const ConversationThread  = require('../models/ConversationThread');
const ConversationMessage = require('../models/ConversationMessage');
const { getAllCachedPrices, TRACKED_ASSETS, getSymbolStatus } = require('../services/binanceService');
const aiService = require('../services/aiService');
const { buildPositionGuidance } = require('../controllers/guideController');

const EXTENDED_PRICE_ASSETS = ['XAUUSD']; // mirrors guideController.js's own list

// tradeId (string) -> last-known recommendation while the trade was open.
// In-memory only, same convention as globalScanJob.js's _lastBest — a
// restart just means the next cycle can't detect a flip until the one
// after that, which is an acceptable, honestly-documented gap for a
// "nice to have proactively" feature, not a safety-critical one.
let _lastRecommendation = new Map();

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

async function runConversationMonitor() {
  try {
    const openTrades = await VirtualTrade.find({ status: 'open' });
    const openIds = new Set(openTrades.map(t => String(t._id)));

    // 1. Recommendation flips on positions still open.
    if (openTrades.length > 0) {
      const { prices, latestByAsset } = await _pricesAndSignalsFor(openTrades);

      for (const trade of openTrades) {
        const guidance = await _guidanceFor(trade, prices, latestByAsset);
        const tid = String(trade._id);
        const prevRec = _lastRecommendation.get(tid);
        _lastRecommendation.set(tid, guidance.recommendation);

        const flippedToSell = prevRec && prevRec !== 'SELL' && guidance.recommendation === 'SELL' && !guidance.isHalted;
        if (flippedToSell) {
          const threadIds = await _threadsLinkedToTrade(trade._id);
          if (threadIds.length > 0) {
            const reasonText = guidance.why?.[0] || 'the outlook on this position has changed';
            const pnlSign = guidance.pnlPct >= 0 ? '+' : '';
            const content = `Update on your ${trade.asset} ${trade.direction} position: I'd consider closing it now — ${reasonText} It's currently at ${pnlSign}${guidance.pnlPct}% (paper P&L, not yet realized).`;
            await _postToThreads(threadIds, content, 'position_flip', [trade._id]);
            logger.info(`[ConversationMonitor] Flip alert — ${trade.asset} → SELL, posted to ${threadIds.length} thread(s)`);
          }
        }
      }
    }

    // 2. Trades that were open last cycle and are gone now — a real close.
    for (const tid of Array.from(_lastRecommendation.keys())) {
      if (openIds.has(tid)) continue;
      _lastRecommendation.delete(tid);

      const trade = await VirtualTrade.findById(tid).lean();
      if (!trade || trade.status === 'open') continue; // deleted or reopened under a new doc — nothing honest to report

      const threadIds = await _threadsLinkedToTrade(tid);
      if (threadIds.length === 0) continue;

      const outcomeText = trade.result === 'win' ? 'closed in profit'
        : trade.result === 'loss' ? 'closed at a loss'
        : 'closed';
      const pnlText = typeof trade.pnl === 'number'
        ? `$${trade.pnl.toFixed(2)} (${trade.pnlPct >= 0 ? '+' : ''}${trade.pnlPct}%)`
        : 'an amount I don\'t have a record of';
      const reasonText = trade.exitReason ? ` Exit reason: ${trade.exitReason}.` : '';
      const content = `Your ${trade.asset} ${trade.direction} position just ${outcomeText} — real paper P&L: ${pnlText}.${reasonText}`;

      await _postToThreads(threadIds, content, 'position_closed', [trade._id]);
      logger.info(`[ConversationMonitor] Close notification — ${trade.asset} ${trade.result || 'closed'}, posted to ${threadIds.length} thread(s)`);
    }
  } catch (err) {
    logger.warn(`[ConversationMonitor] cycle failed: ${err.message}`);
  }
}

function start() {
  // Run once immediately to warm _lastRecommendation (no alerts fire on
  // this first pass — prevRec is undefined for everything), then every
  // 5 minutes, same rhythm as trackerEvalJob/priceAlertJob's polling cadence.
  runConversationMonitor();
  cron.schedule('*/5 * * * *', runConversationMonitor);
  logger.info('[ConversationMonitor] Scheduled — runs every 5 minutes');
}

module.exports = { start, runConversationMonitor, _resetStateForTests: () => { _lastRecommendation = new Map(); } };
