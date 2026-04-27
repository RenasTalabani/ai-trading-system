const VirtualTrade = require('../models/VirtualTrade');

async function getDailyPnL() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);

  const trades = await VirtualTrade.find({
    status: { $in: ['closed_profit', 'closed_loss'] },
    closedAt: { $gte: start },
  }).select('pnl result');

  let profit = 0;
  let loss = 0;
  let wins = 0;

  for (const t of trades) {
    if (t.result === 'win') {
      profit += t.pnl || 0;
      wins++;
    } else {
      loss += Math.abs(t.pnl || 0);
    }
  }

  return {
    profit: +profit.toFixed(2),
    loss: +loss.toFixed(2),
    net: +(profit - loss).toFixed(2),
    winRate: trades.length > 0 ? +(wins / trades.length).toFixed(2) : 0,
    trades: trades.length,
  };
}

module.exports = { getDailyPnL };
