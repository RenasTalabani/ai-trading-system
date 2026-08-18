/**
 * Virtual Performance Tracker — sidecar module.
 * Reads signals read-only; writes only to VirtualTrade / VirtualPortfolio.
 * Zero coupling to signal generation or AI engine.
 */
const Signal           = require('../models/Signal');
const VirtualTrade     = require('../models/VirtualTrade');
const VirtualPortfolio = require('../models/VirtualPortfolio');
const BudgetSession    = require('../models/BudgetSession');
const logger           = require('../config/logger');
const { withPortfolioLock } = require('../utils/portfolioLock');

// Lazy-require to avoid circular dependency at startup
function notifySvc() { return require('./notificationService'); }
function aiSvc()     { return require('./aiService'); }

// ─── Portfolio helpers ────────────────────────────────────────────────────────

async function getPortfolio() {
  let p = await VirtualPortfolio.findOne({ portfolioKey: 'global' });
  if (!p) {
    p = await VirtualPortfolio.create({ portfolioKey: 'global' });
    logger.info('[VirtualTracker] Portfolio initialised — balance: $500');
  }
  return p;
}

// Update peakBalance and maxDrawdown after a balance change
function updateDrawdown(portfolio) {
  if (portfolio.currentBalance > portfolio.peakBalance) {
    portfolio.peakBalance = portfolio.currentBalance;
  }
  const drawdown = ((portfolio.peakBalance - portfolio.currentBalance) / portfolio.peakBalance) * 100;
  if (drawdown > portfolio.maxDrawdown) {
    portfolio.maxDrawdown = parseFloat(drawdown.toFixed(2));
  }
}

// Track best and worst single trade by PnL
function updateBestWorst(portfolio, trade, pnl) {
  const snapshot = {
    pnl:       parseFloat(pnl.toFixed(2)),
    asset:     trade.asset,
    direction: trade.direction,
    closedAt:  new Date(),
  };

  if (portfolio.bestTrade === null || pnl > (portfolio.bestTrade?.pnl ?? -Infinity)) {
    portfolio.bestTrade = snapshot;
  }
  if (portfolio.worstTrade === null || pnl < (portfolio.worstTrade?.pnl ?? Infinity)) {
    portfolio.worstTrade = snapshot;
  }
}

// Default $ distance to trail by, once a trade opts into trailing stop —
// mirrors the original entry-to-SL distance, or 2% of entry if no SL exists.
function trailingDistanceFor(entryPrice, stopLoss) {
  return stopLoss ? Math.abs(entryPrice - stopLoss) : entryPrice * 0.02;
}

// ─── Dynamic position sizing — bet more where there's a proven edge ─────────
//
// Every trade used to risk the same fixed % of balance regardless of whether
// that asset had actually been winning. This scales position size using a
// quarter-Kelly-inspired multiplier from each asset's own recent closed-trade
// history: f* = winRate - (1-winRate)/payoffRatio (classic Kelly fraction),
// taken at 1/4 strength (industry-standard — full Kelly is high-variance) and
// clamped to 0.5x-1.5x so a bad recent streak can't zero out a still-plausible
// signal and a good one can't over-concentrate the account.
const MIN_TRADES_FOR_EDGE = 10;   // below this, not enough data — use baseline (1x)
const KELLY_FRACTION      = 0.25; // quarter-Kelly
const MIN_MULTIPLIER      = 0.5;
const MAX_MULTIPLIER      = 1.5;

// Absolute, final backstop on capital committed to a single position — applied
// AFTER riskPerTradePct and the edge multiplier, so no combination of the two
// (e.g. riskPerTradePct at its schema max of 50% together with the multiplier
// near its practical max of ~1.25x, which alone risks ~61% of balance on one
// trade — confirmed by direct testing) can ever put more than this fraction
// of current balance at risk on one trade. This is a hard ceiling, not a
// suggestion: every caller of the sizing helpers below is capped through it.
const MAX_POSITION_RISK_PCT = 10;

// T-027 (2026-08-18, PM continuous-improvement pass): the live price cache
// (binanceService's WebSocket feed) auto-reconnects on disconnect, but the
// REST fallback poll is only ever started once, 30s after server boot, if
// the cache was still empty then (see server.js). If the WebSocket connects
// fine at startup and then drops for an extended period later at runtime
// (network blip, Binance-side issue, geo-block that starts mid-session),
// nothing restarts REST polling -- the cache just keeps returning
// increasingly stale prices forever, and checkOpenTrades() had no way to
// tell the difference between a fresh price and one from hours ago. A
// stale price could silently fail to trigger a real TP/SL/liquidation, or
// trigger one against a price that no longer reflects the market. Treating
// a too-old cached price the same as "no price" (which the code already
// handles safely by skipping that asset for the cycle) closes this without
// touching the live-stream reconnect logic itself.
const PRICE_STALENESS_MS = 10 * 60 * 1000; // 10 min -- well past one 5-min cycle, tolerant of brief blips


function capToMaxRisk(rawAmountUsd, currentBalance, label) {
  const ceiling = currentBalance * MAX_POSITION_RISK_PCT / 100;
  if (rawAmountUsd > ceiling) {
    logger.warn(
      `[VirtualTracker] Position size capped — ${label} wanted $${rawAmountUsd.toFixed(2)} ` +
      `(${((rawAmountUsd / currentBalance) * 100).toFixed(1)}% of balance), ` +
      `capped to $${ceiling.toFixed(2)} (${MAX_POSITION_RISK_PCT}% hard limit).`
    );
    return ceiling;
  }
  return rawAmountUsd;
}

async function getEdgeMultiplier(asset) {
  const recent = await VirtualTrade.find({
    asset,
    status: { $in: ['closed_profit', 'closed_loss'] },
  }).sort({ closedAt: -1 }).limit(30).lean();

  if (recent.length < MIN_TRADES_FOR_EDGE) return 1.0;

  const wins   = recent.filter(t => t.result === 'win');
  const losses = recent.filter(t => t.result === 'loss');
  if (wins.length === 0 || losses.length === 0) return 1.0; // can't compute a payoff ratio

  const winRate      = wins.length / recent.length;
  const avgWinPct    = wins.reduce((s, t)   => s + Math.abs(t.pnlPct ?? 0), 0) / wins.length;
  const avgLossPct   = losses.reduce((s, t) => s + Math.abs(t.pnlPct ?? 0), 0) / losses.length;
  if (avgLossPct <= 0) return 1.0;

  const payoffRatio = avgWinPct / avgLossPct;
  const kelly       = winRate - (1 - winRate) / payoffRatio; // can be negative — no edge or a losing edge

  const multiplier = 1.0 + (kelly * KELLY_FRACTION);
  return Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, multiplier));
}

// Shared spot-sizing math (riskPerTradePct × edge multiplier, hard-capped) —
// used by pickupNewSignals, approveSuggestion, and previewSizeUsd so every
// caller that opens a spot position sizes it identically.
async function computeSpotSizeUsd(asset, portfolio, label) {
  const baseSizeUsd = (portfolio.currentBalance * portfolio.riskPerTradePct) / 100;
  const edgeMultiplier = await getEdgeMultiplier(asset);
  const sizeUsd = capToMaxRisk(baseSizeUsd * edgeMultiplier, portfolio.currentBalance, label || `${asset} sizing`);
  return { sizeUsd: parseFloat(sizeUsd.toFixed(2)), edgeMultiplier: parseFloat(edgeMultiplier.toFixed(2)) };
}

// Read-only preview of what a trade in this asset would be sized at right
// now, without creating anything — used by the Guide screen to show a dollar
// amount before the user taps "Yes".
async function previewSizeUsd(asset) {
  const portfolio = await getPortfolio();
  const { sizeUsd } = await computeSpotSizeUsd(asset, portfolio, `${asset} preview`);
  return sizeUsd;
}

// ─── Pick up new signals and create VirtualTrades ────────────────────────────

async function pickupNewSignals() {
  try {
    const session = await BudgetSession.findOne({ sessionKey: 'global' });
    if (!session || session.status !== 'active') return 0;

    const tracked = await VirtualTrade.distinct('signalId');

    const newSignals = await Signal.find({
      _id:       { $nin: tracked },
      direction: { $in: ['BUY', 'SELL'] },
      status:    'active',
    }).sort({ createdAt: 1 }).limit(50);

    if (newSignals.length === 0) return 0;

    const portfolio = await getPortfolio();
    const trades = [];

    for (const sig of newSignals) {
      if (!sig.price?.entry) continue;

      const { sizeUsd, edgeMultiplier } = await computeSpotSizeUsd(sig.asset, portfolio, `${sig.asset} spot pickup`);

      trades.push({
        signalId:   sig._id,
        asset:      sig.asset,
        direction:  sig.direction,
        entryPrice: sig.price.entry,
        stopLoss:   sig.price.stopLoss   || null,
        takeProfit: sig.price.takeProfit || null,
        sizeUsd,
        sizeMultiplier: edgeMultiplier,
        trailingStopDistance: trailingDistanceFor(sig.price.entry, sig.price.stopLoss),
        openedAt:   sig.createdAt,
      });
    }

    if (trades.length > 0) {
      await VirtualTrade.insertMany(trades, { ordered: false });

      // Set startedAt on first pickup
      if (!portfolio.startedAt) {
        portfolio.startedAt = trades[0].openedAt || new Date();
        await portfolio.save();
      }

      logger.info(`[VirtualTracker] Picked up ${trades.length} new signal(s) to track.`);
    }

    return trades.length;
  } catch (err) {
    logger.error('[VirtualTracker] pickupNewSignals error:', err.message);
    return 0;
  }
}

// ─── Approve a suggested trade immediately (Guide feature) ───────────────────
// The Guide screen's suggestion comes from the live AI Brain global-scan
// cache (globalScanJob), not from a persisted Signal document, so this takes
// the trade parameters directly rather than a signalId. Same sizing math
// (riskPerTradePct × edge multiplier, hard-capped) as every other path that
// opens a spot position, so a manually-approved trade can never risk more
// than an automatically-picked-up one would.

async function approveSuggestion({ asset, direction, entryPrice, stopLoss, takeProfit }) {
  if (!asset || !entryPrice) {
    throw new Error('Missing asset or entry price.');
  }
  if (!['BUY', 'SELL'].includes(direction)) {
    throw new Error('Only BUY/SELL suggestions can be approved.');
  }

  const alreadyOpen = await VirtualTrade.findOne({ asset, status: 'open' });
  if (alreadyOpen) {
    throw new Error(`Already have an open ${asset} position — nothing new to approve.`);
  }

  const portfolio = await getPortfolio();
  const { sizeUsd, edgeMultiplier } = await computeSpotSizeUsd(asset, portfolio, `${asset} guide approval`);

  const trade = await VirtualTrade.create({
    source:     'guide',
    asset,
    direction,
    entryPrice,
    stopLoss:   stopLoss   || null,
    takeProfit: takeProfit || null,
    sizeUsd,
    sizeMultiplier: edgeMultiplier,
    trailingStopDistance: trailingDistanceFor(entryPrice, stopLoss),
    openedAt:   new Date(),
  });

  if (!portfolio.startedAt) {
    portfolio.startedAt = trade.openedAt;
    await portfolio.save();
  }

  logger.info(`[VirtualTracker] Guide suggestion approved — ${asset} ${direction} @ $${sizeUsd.toFixed(2)}`);
  return trade;
}

// ─── Open a leveraged futures position on an existing signal ─────────────────
// Manual, per-trade opt-in (mirrors real futures trading — you choose leverage
// per position). Independent of the automatic spot pickup above: a signal can
// have both a spot VirtualTrade (auto-tracked) and a futures one (this), or
// just one — whichever happens to run first claims the signalId in the spot
// dedup check, which is fine (no duplicate exposure to the same signal).

async function openFuturesTrade(signalId, leverage) {
  leverage = Math.min(20, Math.max(1, parseInt(leverage, 10) || 1));

  const sig = await Signal.findById(signalId);
  if (!sig || !sig.price?.entry) {
    throw new Error('Signal not found or missing entry price.');
  }
  if (!['BUY', 'SELL'].includes(sig.direction)) {
    throw new Error('Only BUY/SELL signals can be opened as futures.');
  }

  const portfolio = await getPortfolio();
  const edgeMultiplier = await getEdgeMultiplier(sig.asset);
  const baseMarginUsd = (portfolio.currentBalance * portfolio.riskPerTradePct) / 100 / leverage;
  const marginUsd = parseFloat(
    capToMaxRisk(baseMarginUsd * edgeMultiplier, portfolio.currentBalance, `${sig.asset} futures margin`).toFixed(2)
  );

  const liquidationPrice = sig.direction === 'BUY'
    ? sig.price.entry * (1 - 1 / leverage)
    : sig.price.entry * (1 + 1 / leverage);

  const trade = await VirtualTrade.create({
    signalId:         sig._id,
    asset:            sig.asset,
    direction:        sig.direction,
    entryPrice:       sig.price.entry,
    stopLoss:         sig.price.stopLoss   || null,
    takeProfit:       sig.price.takeProfit || null,
    sizeUsd:          parseFloat((marginUsd * leverage).toFixed(2)), // notional
    sizeMultiplier:   parseFloat(edgeMultiplier.toFixed(2)),
    productType:      'futures',
    leverage,
    marginUsd,
    liquidationPrice: parseFloat(liquidationPrice.toFixed(8)),
    trailingStopDistance: trailingDistanceFor(sig.price.entry, sig.price.stopLoss),
    openedAt:         new Date(),
  });

  logger.info(
    `[VirtualTracker] Opened FUTURES ${sig.asset} ${sig.direction} @ ${leverage}x ` +
    `— margin $${marginUsd}, liq @ ${liquidationPrice.toFixed(4)}`
  );
  return trade;
}

// ─── Opt an open trade into trailing stop-loss ────────────────────────────────

async function enableTrailingStop(tradeId) {
  const trade = await VirtualTrade.findById(tradeId);
  if (!trade) throw new Error('Trade not found.');
  if (trade.status !== 'open') throw new Error('Only open trades can enable a trailing stop.');

  trade.trailingStopEnabled = true;
  if (!trade.trailingStopDistance) {
    trade.trailingStopDistance = trailingDistanceFor(trade.entryPrice, trade.stopLoss);
  }
  await trade.save();
  logger.info(`[VirtualTracker] Trailing stop enabled for ${trade.asset} trade ${tradeId} (distance $${trade.trailingStopDistance.toFixed(4)})`);
  return trade;
}

// ─── Funding payments (every 8h, real Binance perpetual rates) ───────────────
// Real funding data only covers BTCUSDT/ETHUSDT (ai-service's macro_data_service
// only fetches those) — other assets simply accrue no funding, rather than a
// fabricated rate standing in for real market data.

async function applyFundingPayments() {
  return withPortfolioLock(async () => {
    try {
      const openFutures = await VirtualTrade.find({ status: 'open', productType: 'futures' });
      if (openFutures.length === 0) return;

      const rates = await aiSvc().getFundingRates();
      if (!rates || Object.keys(rates).length === 0) return;

      const portfolio = await getPortfolio();
      let balanceChanged = false;

      for (const trade of openFutures) {
        const rate = rates[trade.asset]?.funding_rate;
        if (rate === undefined) continue;

        const notionalUsd = trade.marginUsd * trade.leverage;
        // Longs pay shorts when the rate is positive (standard perpetual convention).
        const directionSign = trade.direction === 'BUY' ? -1 : 1;
        const payment = notionalUsd * (rate / 100) * directionSign;

        await VirtualTrade.updateOne({ _id: trade._id }, { $inc: { fundingPaid: payment } });
        portfolio.currentBalance += payment;
        balanceChanged = true;
      }

      if (balanceChanged) {
        portfolio.currentBalance = parseFloat(portfolio.currentBalance.toFixed(2));
        await portfolio.save();
        logger.info(`[VirtualTracker] Applied funding payments to ${openFutures.length} open futures position(s).`);
      }
    } catch (err) {
      logger.error('[VirtualTracker] applyFundingPayments error:', err.message);
    }
  });
}

// ─── Check open trades against current price cache ───────────────────────────

async function checkOpenTrades(priceCache) {
  return withPortfolioLock(async () => {
    try {
      const openTrades = await VirtualTrade.find({ status: 'open' });
      if (openTrades.length === 0) return;

      const portfolio    = await getPortfolio();
      let balanceChanged = false;

      for (const trade of openTrades) {
        const cached = priceCache[trade.asset];
        if (!cached) continue;

        // Object shape ({price, ts}, from binanceService.getAllCachedPrices())
        // is what production always passes; a bare number is a test-only
        // shorthand with no timestamp to check, so it's treated as fresh.
        if (typeof cached === 'object' && cached.ts && (Date.now() - cached.ts) > PRICE_STALENESS_MS) continue;

        const currentPrice = typeof cached === 'object' ? cached.price : cached;
        if (!currentPrice || isNaN(currentPrice)) continue;

        // Trailing stop — tighten stopLoss toward price as it moves favorably.
        // Never loosens; only takes effect once price has moved far enough
        // that the trailed stop would sit past the original one.
        if (trade.trailingStopEnabled && trade.trailingStopDistance) {
          const trailedStop = trade.direction === 'BUY'
            ? currentPrice - trade.trailingStopDistance
            : currentPrice + trade.trailingStopDistance;
          const improved = trade.direction === 'BUY'
            ? (trade.stopLoss == null || trailedStop > trade.stopLoss)
            : (trade.stopLoss == null || trailedStop < trade.stopLoss);
          if (improved) {
            trade.stopLoss = trailedStop;
            await VirtualTrade.updateOne({ _id: trade._id }, { stopLoss: trailedStop });
          }
        }

        let closed     = false;
        let result     = null;
        let exitPrice  = currentPrice;
        let exitReason = null;

        // Liquidation takes priority over TP/SL — it represents total loss of
        // the committed margin, checked first since it's the more severe event.
        if (trade.productType === 'futures' && trade.liquidationPrice) {
          if (trade.direction === 'BUY' && currentPrice <= trade.liquidationPrice) {
            closed = true; result = 'loss'; exitPrice = trade.liquidationPrice; exitReason = 'LIQUIDATED';
          } else if (trade.direction === 'SELL' && currentPrice >= trade.liquidationPrice) {
            closed = true; result = 'loss'; exitPrice = trade.liquidationPrice; exitReason = 'LIQUIDATED';
          }
        }

        if (!closed && trade.direction === 'BUY') {
          if (trade.takeProfit && currentPrice >= trade.takeProfit) {
            closed = true; result = 'win'; exitPrice = trade.takeProfit; exitReason = 'TP';
          } else if (trade.stopLoss && currentPrice <= trade.stopLoss) {
            closed = true; result = 'loss'; exitPrice = trade.stopLoss; exitReason = 'SL';
          }
        } else if (!closed && trade.direction === 'SELL') {
          if (trade.takeProfit && currentPrice <= trade.takeProfit) {
            closed = true; result = 'win'; exitPrice = trade.takeProfit; exitReason = 'TP';
          } else if (trade.stopLoss && currentPrice >= trade.stopLoss) {
            closed = true; result = 'loss'; exitPrice = trade.stopLoss; exitReason = 'SL';
          }
        }

        // Auto-cancel after 24 h
        const ageHours      = (Date.now() - trade.openedAt.getTime()) / 3_600_000;
        const durationMinutes = Math.round(ageHours * 60);
        const balanceBefore = parseFloat(portfolio.currentBalance.toFixed(2));

        if (!closed && ageHours > 24) {
          await VirtualTrade.updateOne({ _id: trade._id }, {
            status:          'cancelled',
            result:          'cancelled',
            exitPrice:       parseFloat(currentPrice.toFixed(8)),
            exitReason:      'EXPIRED',
            pnl:             0,
            pnlPct:          0,
            balanceBefore,
            balanceAfter:    balanceBefore,
            durationMinutes,
            closedAt:        new Date(),
          });
          continue;
        }

        if (!closed) continue;

        // Calculate P&L
        let pnlPct;
        if (trade.direction === 'BUY') {
          pnlPct = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
        } else {
          pnlPct = ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;
        }

        let pnl;
        if (trade.productType === 'futures') {
          pnlPct = pnlPct * trade.leverage; // % of margin, not raw price move
          pnl    = (trade.marginUsd * pnlPct) / 100;
          pnl    = Math.max(pnl, -trade.marginUsd); // can't lose more than margin committed
        } else {
          pnl = (trade.sizeUsd * pnlPct) / 100;
        }
        const balanceAfter = parseFloat((portfolio.currentBalance + pnl).toFixed(2));

        await VirtualTrade.updateOne({ _id: trade._id }, {
          status:          result === 'win' ? 'closed_profit' : 'closed_loss',
          result,
          exitPrice:       parseFloat(exitPrice.toFixed(8)),
          exitReason,
          pnl:             parseFloat(pnl.toFixed(2)),
          pnlPct:          parseFloat(pnlPct.toFixed(2)),
          balanceBefore,
          balanceAfter,
          durationMinutes,
          closedAt:        new Date(),
        });

        // Update portfolio aggregates
        portfolio.currentBalance += pnl;
        if (result === 'win') {
          portfolio.totalProfit += pnl;
          portfolio.winCount    += 1;
        } else {
          portfolio.totalLoss += Math.abs(pnl);
          portfolio.lossCount += 1;
        }

        updateDrawdown(portfolio);
        updateBestWorst(portfolio, trade, pnl);

        portfolio.balanceHistory.push({
          date:    new Date(),
          balance: parseFloat(portfolio.currentBalance.toFixed(2)),
        });
        if (portfolio.balanceHistory.length > 200) {
          portfolio.balanceHistory = portfolio.balanceHistory.slice(-200);
        }

        balanceChanged = true;

        logger.info(
          `[VirtualTracker] Trade closed — ${trade.asset} ${trade.direction} ` +
          `| ${exitReason} | result: ${result} | P&L: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%) ` +
          `| balance: $${portfolio.currentBalance.toFixed(2)}`
        );

        // Fire-and-forget push notification
        try {
          const closedTrade = {
            asset: trade.asset, direction: trade.direction,
            pnl: parseFloat(pnl.toFixed(2)), pnlPct: parseFloat(pnlPct.toFixed(2)),
            exitReason, result,
          };
          notifySvc().sendTradeClosedNotification(closedTrade, portfolio).catch(() => {});
        } catch (_) {}
      }

      if (balanceChanged) {
        portfolio.currentBalance = parseFloat(portfolio.currentBalance.toFixed(2));
        portfolio.totalProfit    = parseFloat(portfolio.totalProfit.toFixed(2));
        portfolio.totalLoss      = parseFloat(portfolio.totalLoss.toFixed(2));
        await portfolio.save();
      }
    } catch (err) {
      logger.error('[VirtualTracker] checkOpenTrades error:', err.message);
    }
  });
}

// ─── Close a position right now, at the current market price ─────────────────
// Powers the Guide screen's "Sell Now" button — when the AI flags a position
// as SELL, this actually closes it immediately rather than waiting for
// price to reach the original TP/SL. The P&L math intentionally mirrors
// checkOpenTrades' closing block exactly (same formulas, same portfolio
// aggregate updates) but is kept as its own function rather than a shared
// helper, so refactoring this newer, less-tested path can never risk
// destabilizing the already-verified TP/SL/liquidation logic above.

async function closePositionNow(tradeId, currentPrice) {
  return withPortfolioLock(async () => {
    const trade = await VirtualTrade.findOne({ _id: tradeId, status: 'open' });
    if (!trade) {
      throw new Error('Position not found or already closed.');
    }
    if (!currentPrice || isNaN(currentPrice)) {
      throw new Error('No live price available for this asset right now.');
    }

    const portfolio = await getPortfolio();
    const exitPrice = currentPrice;

    let pnlPct = trade.direction === 'BUY'
      ? ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100
      : ((trade.entryPrice - exitPrice) / trade.entryPrice) * 100;

    let pnl;
    if (trade.productType === 'futures') {
      pnlPct = pnlPct * trade.leverage;
      pnl    = (trade.marginUsd * pnlPct) / 100;
      pnl    = Math.max(pnl, -trade.marginUsd);
    } else {
      pnl = (trade.sizeUsd * pnlPct) / 100;
    }

    const result = pnl >= 0 ? 'win' : 'loss';
    const balanceBefore   = parseFloat(portfolio.currentBalance.toFixed(2));
    const balanceAfter    = parseFloat((portfolio.currentBalance + pnl).toFixed(2));
    const durationMinutes = Math.round((Date.now() - trade.openedAt.getTime()) / 60_000);

    await VirtualTrade.updateOne({ _id: trade._id }, {
      status:          result === 'win' ? 'closed_profit' : 'closed_loss',
      result,
      exitPrice:       parseFloat(exitPrice.toFixed(8)),
      exitReason:      'MANUAL',
      pnl:             parseFloat(pnl.toFixed(2)),
      pnlPct:          parseFloat(pnlPct.toFixed(2)),
      balanceBefore,
      balanceAfter,
      durationMinutes,
      closedAt:        new Date(),
    });

    portfolio.currentBalance += pnl;
    if (result === 'win') {
      portfolio.totalProfit += pnl;
      portfolio.winCount    += 1;
    } else {
      portfolio.totalLoss += Math.abs(pnl);
      portfolio.lossCount += 1;
    }
    updateDrawdown(portfolio);
    updateBestWorst(portfolio, trade, pnl);
    portfolio.balanceHistory.push({ date: new Date(), balance: parseFloat(portfolio.currentBalance.toFixed(2)) });
    if (portfolio.balanceHistory.length > 200) {
      portfolio.balanceHistory = portfolio.balanceHistory.slice(-200);
    }
    portfolio.currentBalance = parseFloat(portfolio.currentBalance.toFixed(2));
    portfolio.totalProfit    = parseFloat(portfolio.totalProfit.toFixed(2));
    portfolio.totalLoss      = parseFloat(portfolio.totalLoss.toFixed(2));
    await portfolio.save();

    logger.info(
      `[VirtualTracker] Manual sell — ${trade.asset} ${trade.direction} ` +
      `| result: ${result} | P&L: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%) ` +
      `| balance: $${portfolio.currentBalance}`
    );

    try {
      notifySvc().sendTradeClosedNotification(
        { asset: trade.asset, direction: trade.direction, pnl: parseFloat(pnl.toFixed(2)), pnlPct: parseFloat(pnlPct.toFixed(2)), exitReason: 'MANUAL', result },
        portfolio,
      ).catch(() => {});
    } catch (_) {}

    return {
      asset: trade.asset,
      direction: trade.direction,
      pnl: parseFloat(pnl.toFixed(2)),
      pnlPct: parseFloat(pnlPct.toFixed(2)),
      result,
      exitPrice: parseFloat(exitPrice.toFixed(8)),
    };
  });
}

// ─── Date range helper ────────────────────────────────────────────────────────

function rangeStart(range) {
  if (range === '1d')  return new Date(Date.now() -  1 * 24 * 3_600_000);
  if (range === '7d')  return new Date(Date.now() -  7 * 24 * 3_600_000);
  if (range === '30d') return new Date(Date.now() - 30 * 24 * 3_600_000);
  return null; // 'all'
}

// ─── Summary with time-range filtering ───────────────────────────────────────

async function getSummary(range = 'all') {
  const portfolio  = await getPortfolio();
  const since      = rangeStart(range);
  const dateFilter = since ? { closedAt: { $gte: since } } : {};

  const [closedTrades, openTrades] = await Promise.all([
    VirtualTrade.find({ status: { $in: ['closed_profit', 'closed_loss'] }, ...dateFilter }).lean(),
    VirtualTrade.countDocuments({ status: 'open' }),
  ]);

  const wins   = closedTrades.filter(t => t.result === 'win');
  const losses = closedTrades.filter(t => t.result === 'loss');

  const totalPnl     = closedTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const totalProfit  = wins.reduce((s, t)   => s + (t.pnl ?? 0), 0);
  const totalLoss    = losses.reduce((s, t) => s + Math.abs(t.pnl ?? 0), 0);
  const totalTrades  = closedTrades.length;
  const winRate      = totalTrades > 0 ? parseFloat(((wins.length / totalTrades) * 100).toFixed(1)) : 0;
  const avgDuration  = totalTrades > 0
    ? Math.round(closedTrades.reduce((s, t) => s + (t.durationMinutes ?? 0), 0) / totalTrades)
    : 0;

  // Range-specific best/worst
  let bestTrade  = null;
  let worstTrade = null;
  for (const t of closedTrades) {
    if (!bestTrade  || t.pnl > bestTrade.pnl)  bestTrade  = t;
    if (!worstTrade || t.pnl < worstTrade.pnl) worstTrade = t;
  }

  return {
    range,
    startingBalance: portfolio.startingBalance,
    currentBalance:  portfolio.currentBalance,
    riskPerTradePct: portfolio.riskPerTradePct,
    netProfit:       parseFloat((portfolio.currentBalance - portfolio.startingBalance).toFixed(2)),
    netProfitPct:    parseFloat(((portfolio.currentBalance - portfolio.startingBalance) / portfolio.startingBalance * 100).toFixed(2)),
    totalProfit:     parseFloat(totalProfit.toFixed(2)),
    totalLoss:       parseFloat(totalLoss.toFixed(2)),
    totalPnl:        parseFloat(totalPnl.toFixed(2)),
    winCount:        wins.length,
    lossCount:       losses.length,
    totalTrades,
    openTrades,
    winRate,
    avgDurationMinutes: avgDuration,
    maxDrawdown:     portfolio.maxDrawdown,
    peakBalance:     portfolio.peakBalance,
    bestTrade:       range === 'all' ? portfolio.bestTrade : bestTrade ? {
      pnl: bestTrade.pnl, asset: bestTrade.asset,
      direction: bestTrade.direction, closedAt: bestTrade.closedAt,
    } : null,
    worstTrade:      range === 'all' ? portfolio.worstTrade : worstTrade ? {
      pnl: worstTrade.pnl, asset: worstTrade.asset,
      direction: worstTrade.direction, closedAt: worstTrade.closedAt,
    } : null,
    balanceHistory:  range === 'all'
      ? portfolio.balanceHistory.slice(-100)
      : portfolio.balanceHistory.filter(p => !since || p.date >= since).slice(-100),
    startedAt:  portfolio.startedAt,
    updatedAt:  portfolio.updatedAt,
  };
}

// ─── Legacy getPerformance (unchanged surface, now delegates) ─────────────────

async function getPerformance() {
  return getSummary('all');
}

// ─── Portfolio exposure — concentration & leverage risk across open trades ───

async function getExposureSummary() {
  const openTrades = await VirtualTrade.find({ status: 'open' }).lean();
  const portfolio   = await getPortfolio();

  const totalNotional = openTrades.reduce((s, t) => s + (t.sizeUsd || 0), 0);
  const totalMargin    = openTrades.reduce((s, t) => s + (t.marginUsd ?? t.sizeUsd ?? 0), 0);

  const byAsset = {};
  for (const t of openTrades) {
    if (!byAsset[t.asset]) {
      byAsset[t.asset] = { notionalUsd: 0, count: 0, directions: { BUY: 0, SELL: 0 } };
    }
    byAsset[t.asset].notionalUsd += t.sizeUsd || 0;
    byAsset[t.asset].count += 1;
    byAsset[t.asset].directions[t.direction] += 1;
  }
  for (const asset of Object.keys(byAsset)) {
    byAsset[asset].concentrationPct = totalNotional > 0
      ? parseFloat(((byAsset[asset].notionalUsd / totalNotional) * 100).toFixed(1))
      : 0;
  }

  // Simple correlation warning: 3+ open positions all pointing the same
  // direction means the account is effectively one big directional bet,
  // regardless of how many different assets that spans.
  const directionCounts = openTrades.reduce((acc, t) => {
    acc[t.direction] = (acc[t.direction] || 0) + 1;
    return acc;
  }, {});
  const dominantDirection = Object.entries(directionCounts).sort((a, b) => b[1] - a[1])[0];
  const concentratedDirectionWarning = !!dominantDirection && dominantDirection[1] >= 3
    && dominantDirection[1] === openTrades.length;

  const futuresTrades = openTrades.filter(t => t.productType === 'futures');
  const nearLiquidation = futuresTrades.filter(t => {
    if (!t.liquidationPrice) return false;
    const distancePct = Math.abs(t.entryPrice - t.liquidationPrice) / t.entryPrice * 100;
    return distancePct < 5; // liquidation within 5% of entry — high leverage risk
  }).length;

  return {
    openPositions:    openTrades.length,
    totalNotionalUsd: parseFloat(totalNotional.toFixed(2)),
    totalMarginUsd:   parseFloat(totalMargin.toFixed(2)),
    exposurePctOfBalance: portfolio.currentBalance > 0
      ? parseFloat(((totalNotional / portfolio.currentBalance) * 100).toFixed(1))
      : 0,
    futuresPositions: futuresTrades.length,
    nearLiquidationCount: nearLiquidation,
    byAsset,
    concentratedDirectionWarning,
    dominantDirection: dominantDirection ? dominantDirection[0] : null,
  };
}

// ─── Reset / set-capital ─────────────────────────────────────────────────────

async function resetPortfolio(startingBalance = 500, riskPerTradePct = 5) {
  await VirtualTrade.deleteMany({});
  await VirtualPortfolio.deleteMany({});
  await VirtualPortfolio.create({
    portfolioKey:    'global',
    startingBalance,
    currentBalance:  startingBalance,
    riskPerTradePct,
    peakBalance:     startingBalance,
    maxDrawdown:     0,
    bestTrade:       null,
    worstTrade:      null,
    startedAt:       null,
    totalProfit: 0, totalLoss: 0,
    winCount: 0,    lossCount: 0,
    balanceHistory: [{ date: new Date(), balance: startingBalance }],
  });
  logger.info(`[VirtualTracker] Portfolio reset — starting balance: $${startingBalance}`);
}

async function setCapital(startingBalance, riskPerTradePct) {
  const portfolio = await getPortfolio();
  if (startingBalance)  portfolio.startingBalance  = startingBalance;
  if (riskPerTradePct) portfolio.riskPerTradePct  = riskPerTradePct;
  await portfolio.save();
}

module.exports = {
  pickupNewSignals, checkOpenTrades, getPerformance, getSummary,
  resetPortfolio, setCapital, openFuturesTrade, applyFundingPayments,
  enableTrailingStop, getExposureSummary, getEdgeMultiplier, capToMaxRisk,
  approveSuggestion, previewSizeUsd, closePositionNow, MAX_POSITION_RISK_PCT,
};
