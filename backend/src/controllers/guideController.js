/**
 * Guide — the "just tell me what to do" screen. One suggestion, plain
 * language, a dollar amount, and a Low/Medium/High risk label instead of a
 * confidence percentage. Nothing happens until the user taps "Yes" — see
 * approve() below, which reuses the exact same sizing/cap logic as every
 * other trade-opening path in the app.
 *
 * Suggestion source: the AI Brain global-scan cache (globalScanJob) is tried
 * first — it's the highest-quality, cross-validated pick — but its filter
 * (confidence >= 70 AND fused_score >= 65, simultaneously) rejects nearly
 * every candidate in practice (observed: 0 qualifying picks across ~10+
 * consecutive scan cycles in normal operation). Falling back to the regular
 * Signal pipeline (same data source the rest of the app already trusts and
 * displays) is what makes this screen actually show something most of the
 * time, which is the entire point of it.
 */
const { getCache: getGlobalCache } = require('../jobs/globalScanJob');
const Signal = require('../models/Signal');
const AIDecision = require('../models/AIDecision');
const VirtualTrade = require('../models/VirtualTrade');
const { getAllCachedPrices, getSymbolStatus, TRACKED_ASSETS } = require('../services/binanceService');
const aiService = require('../services/aiService');
const { approveSuggestion, previewSizeUsd, getSummary, closePositionNow } = require('../services/virtualTrackingService');
const logger = require('../config/logger');

// binanceService's price cache only covers crypto (TRACKED_ASSETS) -- these
// need a separate live-price lookup, same list virtualTrackingJob.js uses.
const EXTENDED_PRICE_ASSETS = ['XAUUSD'];

// The dollar loss if this position/suggestion hits its stop-loss exactly --
// the honest, concrete "how much could I lose" number, not a guess. Returns
// null when there's no stop-loss set, since the downside is then genuinely
// undefined (not zero) and shouldn't be silently treated as "no risk."
function maxLossFor(direction, entryPrice, stopLoss, sizeUsd) {
  if (!stopLoss || !entryPrice || !sizeUsd) return null;
  const lossPct = direction === 'BUY'
    ? (entryPrice - stopLoss) / entryPrice
    : (stopLoss - entryPrice) / entryPrice;
  if (lossPct <= 0) return null; // stop-loss on the wrong side somehow -- don't report a nonsense number
  return parseFloat((sizeUsd * lossPct).toFixed(2));
}

// The dollar gain if this position/suggestion hits its take-profit exactly
// -- the symmetric "how much could I win" number. Returns null when there's
// no take-profit set, for the same reason maxLossFor returns null with no
// stop-loss: undefined upside shouldn't be silently reported as zero.
function maxGainFor(direction, entryPrice, takeProfit, sizeUsd) {
  if (!takeProfit || !entryPrice || !sizeUsd) return null;
  const gainPct = direction === 'BUY'
    ? (takeProfit - entryPrice) / entryPrice
    : (entryPrice - takeProfit) / entryPrice;
  if (gainPct <= 0) return null; // take-profit on the wrong side somehow -- don't report a nonsense number
  return parseFloat((sizeUsd * gainPct).toFixed(2));
}

function riskLevelFor(confidence) {
  if (confidence >= 80) return 'Low';
  if (confidence >= 60) return 'Medium';
  return 'High';
}

function confidenceWordsFor(confidence) {
  if (confidence >= 80) return 'very confident';
  if (confidence >= 60) return 'fairly confident';
  return 'somewhat confident';
}

function plainWhyFromGlobalBest(best) {
  const lines = [];
  const dirWord = best.action === 'BUY' ? 'rising' : 'falling';
  if (best.trend) {
    lines.push(`The price has been ${dirWord}, matching a ${String(best.trend).toLowerCase()} trend.`);
  } else {
    lines.push(`The AI expects the price to keep ${dirWord}.`);
  }
  if (typeof best.expected_return === 'number' && best.expected_return > 0) {
    lines.push(`Potential gain if this plays out: about ${best.expected_return.toFixed(1)}%.`);
  }
  return lines;
}

function plainWhyFromSignal(sig) {
  const lines = [];
  const dirWord = sig.direction === 'BUY' ? 'rising' : 'falling';
  const rsi = sig.sources?.market?.indicators?.rsi;
  const momentumFits = typeof rsi === 'number' &&
    ((sig.direction === 'BUY' && rsi > 55) || (sig.direction === 'SELL' && rsi < 45));
  lines.push(momentumFits
    ? `Price momentum has been building — a common early sign of a ${dirWord} move.`
    : `The AI expects the price to keep ${dirWord}.`);

  const socialSentiment = sig.sources?.social?.sentiment;
  if (socialSentiment) lines.push(`Social media chatter about it right now is mostly ${socialSentiment}.`);
  return lines;
}

// Tries the high-quality global scan first, falls back to the best active
// signal from the regular pipeline. Returns a normalized shape or null.
// Never suggests an asset that's already an open trade -- without this, the
// same suggestion can be approved over and over (each tap opening another
// real trade for the same asset, since nothing else marks it as "done").
async function resolveSuggestion() {
  const openAssets = await VirtualTrade.distinct('asset', { status: 'open' });

  const cached = getGlobalCache();
  const best = cached?.result?.best;
  if (best?.current_price && !openAssets.includes(best.asset)) {
    return {
      asset:       best.asset,
      displayName: best.display_name || best.asset,
      action:      best.action,
      // T-066: ai-service's global-scan `best` already carries `decision`
      // (WAIT/AVOID label, T-066) end to end from UnifiedAnalyzer/
      // GlobalAnalyzer — falls back to `action` so an older ai-service
      // response shape (missing the key) still resolves to something
      // sane instead of undefined.
      decision:    best.decision || best.action,
      entryPrice:  best.current_price,
      stopLoss:    best.stop_loss   || null,
      takeProfit:  best.take_profit || null,
      confidence:  best.confidence ?? 0,
      why:         plainWhyFromGlobalBest(best),
      generatedAt: cached.scannedAt,
      signalId:    null, // sourced from the global-scan cache, not a persisted Signal — see approve() (T-061)
    };
  }

  const sig = await Signal.findOne({
    status: 'active',
    direction: { $in: ['BUY', 'SELL'] },
    asset: { $nin: openAssets },
    'price.entry': { $exists: true },
  }).sort({ confidence: -1 });

  if (sig) {
    return {
      asset:       sig.asset,
      displayName: sig.asset,
      action:      sig.direction,
      // T-066: mirrors the global-scan branch above — falls back to
      // `direction` for Signal documents created before this field
      // existed (schema has no default, so it's simply undefined on those).
      decision:    sig.decision || sig.direction,
      entryPrice:  sig.price.entry,
      stopLoss:    sig.price.stopLoss   || null,
      takeProfit:  sig.price.takeProfit || null,
      confidence:  sig.confidence ?? 0,
      why:         plainWhyFromSignal(sig),
      generatedAt: sig.createdAt,
      signalId:    sig._id, // T-061: threaded through to approve() so the resulting trade is traceable
    };
  }

  return null;
}

// Decides HOLD vs SELL for a position you already opened, in plain language.
// SELL is only recommended when something has genuinely changed since entry
// (the AI's read on the asset flipped, or it looks over/oversold) -- it does
// NOT second-guess a healthy, on-plan position. HOLD estimates are a rough,
// honest qualitative guess based on how far price has already moved toward
// the take-profit target, not a real prediction.
// BUG-003 (2026-08-29 overnight validation): a tracked asset with no
// live price available (confirmed halted on the exchange, e.g. MATICUSDT
// under Binance's "BREAK" status during the MATIC->POL migration) used to
// silently fall back to trade.entryPrice here, rendering an indefinite,
// indistinguishable-from-real "0% P&L, nothing has changed" state for as
// long as the halt lasts. isHalted is now computed explicitly by the
// caller (getPositions(), via binanceService.getSymbolStatus()) and
// short-circuits to an honest "price unavailable" state instead of
// guessing at a P&L that cannot actually be known right now.
function buildPositionGuidance(trade, currentPrice, latestSignal, isHalted = false) {
  if (isHalted) {
    return {
      tradeId: trade._id,
      asset: trade.asset,
      direction: trade.direction,
      sizeUsd: trade.sizeUsd,
      entryPrice: trade.entryPrice,
      currentPrice: null,
      pnlPct: null,
      recommendation: 'HOLD',
      why: [`${trade.asset} appears to be halted on the exchange right now — its price is unavailable, so P&L can't be shown until trading resumes.`],
      holdEstimate: null,
      isHalted: true,
      maxLossUsd: null,
      maxGainUsd: null,
      openedAt: trade.openedAt,
    };
  }

  const pnlPct = trade.direction === 'BUY'
    ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
    : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;

  let recommendation = 'HOLD';
  const why = [];

  const contradicts = latestSignal
    && latestSignal.status === 'active'
    && ['BUY', 'SELL'].includes(latestSignal.direction)
    && latestSignal.direction !== trade.direction;
  if (contradicts) {
    recommendation = 'SELL';
    why.push(`The AI's outlook on ${trade.asset} has flipped since you bought — it now leans the other way.`);
  }

  const rsi = latestSignal?.sources?.market?.indicators?.rsi;
  if (recommendation === 'HOLD' && typeof rsi === 'number') {
    if (trade.direction === 'BUY' && rsi > 75) {
      recommendation = 'SELL';
      why.push(`It looks overbought right now (RSI ${rsi.toFixed(0)}) — that's often followed by a pullback.`);
    } else if (trade.direction === 'SELL' && rsi < 25) {
      recommendation = 'SELL';
      why.push(`It looks oversold right now (RSI ${rsi.toFixed(0)}) — that's often followed by a bounce.`);
    }
  }

  let holdEstimate = null;
  if (recommendation === 'HOLD') {
    why.push('Nothing has changed since you opened this — the original reasons still hold.');
    if (trade.takeProfit) {
      const totalMove = Math.abs(trade.takeProfit - trade.entryPrice);
      const doneMove   = trade.direction === 'BUY'
        ? (currentPrice - trade.entryPrice)
        : (trade.entryPrice - currentPrice);
      const progress = totalMove > 0 ? Math.max(0, Math.min(1, doneMove / totalMove)) : 0;
      if (progress >= 0.7)      holdEstimate = 'Probably just a few more hours';
      else if (progress >= 0.3) holdEstimate = 'Could take about a day';
      else                      holdEstimate = 'Could take a few days';
    }
  }

  return {
    tradeId: trade._id,
    asset: trade.asset,
    direction: trade.direction,
    sizeUsd: trade.sizeUsd,
    entryPrice: trade.entryPrice,
    currentPrice,
    pnlPct: parseFloat(pnlPct.toFixed(2)),
    recommendation,
    why,
    holdEstimate,
    isHalted: false,
    maxLossUsd: maxLossFor(trade.direction, trade.entryPrice, trade.stopLoss, trade.sizeUsd),
    maxGainUsd: maxGainFor(trade.direction, trade.entryPrice, trade.takeProfit, trade.sizeUsd),
    openedAt: trade.openedAt,
  };
}

// Single-asset live price lookup, same routing rule used throughout the app:
// crypto from binanceService's cache, everything else (gold, etc.) via ai-service.
async function getLivePrice(asset) {
  if (EXTENDED_PRICE_ASSETS.includes(asset)) {
    return await aiService.getPrice(asset);
  }
  const cached = getAllCachedPrices()[asset];
  return cached ? (typeof cached === 'object' ? cached.price : cached) : null;
}

exports.buildPositionGuidance = buildPositionGuidance;
exports.maxLossFor = maxLossFor;
exports.maxGainFor = maxGainFor;
exports.resolveSuggestion = resolveSuggestion;

exports.getPositions = async (req, res) => {
  try {
    const openTrades = await VirtualTrade.find({ status: 'open' }).sort({ openedAt: -1 });
    const { currentBalance } = await getSummary('all');

    if (openTrades.length === 0) {
      return res.json({
        success: true, positions: [],
        totalAtRiskUsd: 0, totalAtRiskPct: 0, positionsWithoutStopLoss: 0,
        totalPotentialGainUsd: 0, totalPotentialGainPct: 0, positionsWithoutTakeProfit: 0,
        currentBalance,
      });
    }

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

    // BUG-003: a missing cache entry for a tracked crypto asset can mean
    // either "genuinely halted on the exchange" (MATICUSDT's case) or just
    // "cache hasn't populated yet" (e.g. right after a server restart) --
    // only check the real exchange status for assets that actually hit
    // this gap, so this doesn't add a Binance call to every position on
    // every request.
    const positions = await Promise.all(openTrades.map(async trade => {
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
      // Unknown/transient gap (not a confirmed halt) -- entryPrice fallback
      // preserved here exactly as before, so a brief post-restart cache gap
      // still shows a reasonable (if momentarily stale) position instead of
      // an alarming "halted" label it hasn't actually earned.
      return buildPositionGuidance(trade, trade.entryPrice, latestByAsset[trade.asset]);
    }));

    // Live, "always on" risk total: the sum of every position's defined
    // worst-case loss (if every stop-loss hit at once, unrealistic but the
    // honest theoretical ceiling), refreshed on the same clock the screen
    // already polls on. Positions with no stop-loss have undefined downside
    // and are called out separately rather than silently counted as zero.
    const withStop = positions.filter(p => p.maxLossUsd !== null);
    const totalAtRiskUsd = parseFloat(withStop.reduce((s, p) => s + p.maxLossUsd, 0).toFixed(2));
    const totalAtRiskPct = currentBalance > 0 ? parseFloat(((totalAtRiskUsd / currentBalance) * 100).toFixed(1)) : 0;

    // Symmetric upside figure: the sum of every position's defined best-case
    // gain (if every take-profit hit at once) -- same "always on" treatment
    // as the risk total, same honesty rule for positions with no take-profit set.
    const withTakeProfit = positions.filter(p => p.maxGainUsd !== null);
    const totalPotentialGainUsd = parseFloat(withTakeProfit.reduce((s, p) => s + p.maxGainUsd, 0).toFixed(2));
    const totalPotentialGainPct = currentBalance > 0 ? parseFloat(((totalPotentialGainUsd / currentBalance) * 100).toFixed(1)) : 0;

    res.json({
      success: true,
      positions,
      totalAtRiskUsd,
      totalAtRiskPct,
      positionsWithoutStopLoss: positions.length - withStop.length,
      totalPotentialGainUsd,
      totalPotentialGainPct,
      positionsWithoutTakeProfit: positions.length - withTakeProfit.length,
      currentBalance,
    });
  } catch (err) {
    logger.error(`[Guide] getPositions failed: ${err.stack}`);
    res.status(500).json({ success: false, message: 'Could not load your positions right now.' });
  }
};

exports.getSuggestion = async (req, res) => {
  try {
    const suggestion = await resolveSuggestion();
    if (!suggestion) {
      return res.json({
        success: true,
        available: false,
        message: 'The AI is still studying the markets. Check back in a few minutes.',
      });
    }

    const amountUsd = await previewSizeUsd(suggestion.asset);
    const maxLossUsd = maxLossFor(suggestion.action, suggestion.entryPrice, suggestion.stopLoss, amountUsd);
    const maxGainUsd = maxGainFor(suggestion.action, suggestion.entryPrice, suggestion.takeProfit, amountUsd);

    res.json({
      success: true,
      available: true,
      asset: suggestion.asset,
      displayName: suggestion.displayName,
      action: suggestion.action,
      // T-066: WAIT/AVOID label, purely additive -- `action` above is
      // unchanged and still drives approve()'s actual trade direction.
      decision: suggestion.decision,
      entryPrice: suggestion.entryPrice,
      stopLoss: suggestion.stopLoss,
      takeProfit: suggestion.takeProfit,
      amountUsd,
      maxLossUsd,
      maxGainUsd,
      why: suggestion.why,
      riskLevel: riskLevelFor(suggestion.confidence),
      confidenceWords: confidenceWordsFor(suggestion.confidence),
      generatedAt: suggestion.generatedAt,
    });
  } catch (err) {
    logger.error(`[Guide] getSuggestion failed: ${err.stack}`);
    res.status(500).json({ success: false, message: 'Could not load a suggestion right now.' });
  }
};

exports.approve = async (req, res) => {
  try {
    const suggestion = await resolveSuggestion();
    if (!suggestion) {
      return res.status(409).json({ success: false, message: 'No suggestion available right now — try again shortly.' });
    }

    // T-061 (2026-08-26, product-to-code audit follow-up): the audit found
    // that approveSuggestion() persisted neither signalId nor aiDecisionId
    // on the resulting VirtualTrade, so a Guide-approved trade could not be
    // traced back to the specific AI-sourced pick that justified it, even
    // though resolveSuggestion() above always sources it from an AI signal
    // or the global-scan cache (never from client input). Thread that link
    // through now. For a Signal-sourced suggestion this is exact
    // (suggestion.signalId). For a global-scan-sourced suggestion there's no
    // persisted id at resolve time (decisionTrackingJob writes it
    // fire-and-forget, and T-058's state-change gate means it may not write
    // a fresh one at all) -- so this does a best-effort lookup of the most
    // recent matching AIDecision and leaves it null on a miss, rather than
    // ever blocking approval or guessing wrong.
    let aiDecisionId = null;
    if (!suggestion.signalId) {
      const recentDecision = await AIDecision.findOne({
        asset: suggestion.asset, action: suggestion.action,
      }).sort({ createdAt: -1 }).lean();
      if (recentDecision) aiDecisionId = recentDecision._id;
    }

    const trade = await approveSuggestion({
      asset:      suggestion.asset,
      direction:  suggestion.action,
      entryPrice: suggestion.entryPrice,
      stopLoss:   suggestion.stopLoss,
      takeProfit: suggestion.takeProfit,
      signalId:   suggestion.signalId || null,
      aiDecisionId,
    });

    const verb = trade.direction === 'BUY' ? 'Bought' : 'Sold';
    res.json({
      success: true,
      message: `Done — ${verb} $${trade.sizeUsd} of ${suggestion.displayName}.`,
      trade,
    });
  } catch (err) {
    logger.warn(`[Guide] approve rejected: ${err.message}`);
    res.status(400).json({ success: false, message: err.message });
  }
};

// The "Sell Now" button on a position the AI flagged as SELL -- closes it
// immediately at the current market price rather than waiting for TP/SL.
exports.sellNow = async (req, res) => {
  try {
    const trade = await VirtualTrade.findById(req.params.tradeId);
    if (!trade) {
      return res.status(404).json({ success: false, message: 'Position not found.' });
    }

    const currentPrice = await getLivePrice(trade.asset);
    if (!currentPrice) {
      // BUG-003: a genuinely exchange-halted symbol (confirmed via a real
      // status check, not guessed) will never get a live price again on
      // its own -- "try again shortly" is actively misleading for that
      // case, so it's offered a manual close at the trade's last-known
      // (entry) price instead of being blocked indefinitely. A transient
      // cache gap that isn't a confirmed halt keeps the original behavior.
      let isHalted = false;
      if (TRACKED_ASSETS.includes(trade.asset)) {
        const status = await getSymbolStatus(trade.asset);
        isHalted = !!status && status !== 'TRADING';
      }
      if (!isHalted) {
        return res.status(409).json({ success: false, message: "No live price available for this asset right now — try again shortly." });
      }
      const result = await closePositionNow(req.params.tradeId, trade.entryPrice, 'HALTED');
      return res.json({
        success: true,
        message: `${result.asset} is halted on the exchange — closed at its last-known price (no gain/loss from the halt itself).`,
        result,
      });
    }

    const result = await closePositionNow(req.params.tradeId, currentPrice);
    const verb = result.pnl >= 0 ? 'up' : 'down';
    res.json({
      success: true,
      message: `Sold ${result.asset} — you're $${Math.abs(result.pnl).toFixed(2)} ${verb} (${result.pnlPct.toFixed(2)}%).`,
      result,
    });
  } catch (err) {
    logger.warn(`[Guide] sellNow rejected: ${err.message}`);
    res.status(400).json({ success: false, message: err.message });
  }
};
