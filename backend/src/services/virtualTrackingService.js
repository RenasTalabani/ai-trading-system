/**
 * Virtual Performance Tracker — sidecar module.
 * Reads signals read-only; writes only to VirtualTrade / VirtualPortfolio.
 * Zero coupling to signal generation or AI engine.
 */
const Signal           = require('../models/Signal');
const VirtualTrade     = require('../models/VirtualTrade');
const VirtualPortfolio = require('../models/VirtualPortfolio');
const logger           = require('../config/logger');

// Lazy-require to avoid circular dependency at startup
function notifySvc() { return require('./notificationService'); }

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

// ─── Pick up new signals and create VirtualTrades ────────────────────────────

async function pickupNewSignals() {
  try {
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

      const sizeUsd = (portfolio.currentBalance * portfolio.riskPerTradePct) / 100;

      trades.push({
        signalId:   sig._id,
        asset:      sig.asset,
        direction:  sig.direction,
        entryPrice: sig.price.entry,
        stopLoss:   sig.price.stopLoss   || null,
        takeProfit: sig.price.takeProfit || null,
        sizeUsd:    parseFloat(sizeUsd.toFixed(2)),
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

// ─── Check open trades against current price cache ───────────────────────────

async function checkOpenTrades(priceCache) {
  try {
    const openTrades = await VirtualTrade.find({ status: 'open' });
    if (openTrades.length === 0) return;

    const portfolio    = await getPortfolio();
    let balanceChanged = false;

    for (const trade of openTrades) {
      const cached = priceCache[trade.asset];
      if (!cached) continue;

      const currentPrice = typeof cached === 'object' ? cached.price : cached;
      if (!currentPrice || isNaN(currentPrice)) continue;

      let closed     = false;
      let result     = null;
      let exitPrice  = currentPrice;
      let exitReason = null;

      if (trade.direction === 'BUY') {
        if (trade.takeProfit && currentPrice >= trade.takeProfit) {
          closed = true; result = 'win'; exitPrice = trade.takeProfit; exitReason = 'TP';
        } else if (trade.stopLoss && currentPrice <= trade.stopLoss) {
          closed = true; result = 'loss'; exitPrice = trade.stopLoss; exitReason = 'SL';
        }
      } else if (trade.direction === 'SELL') {
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
      const pnl        = (trade.sizeUsd * pnlPct) / 100;
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
}

// ─── Date range helper ────────────────────────────────────────────────────────

function rangeStart(range) {
  if (range === '7d')  return new Date(Date.now() - 7  * 24 * 3_600_000);
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

module.exports = { pickupNewSignals, checkOpenTrades, getPerformance, getSummary, resetPortfolio, setCapital };
