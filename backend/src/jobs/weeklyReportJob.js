/**
 * Weekly Report Job — runs every Monday at 08:00 UTC.
 * Reports actual virtual trade performance over the past 7 days.
 */
const cron = require('node-cron');
const { getSummary } = require('../services/virtualTrackingService');
const BudgetSession  = require('../models/BudgetSession');
const User           = require('../models/User');
const { sendPushToUser, sendTelegramMessage } = require('../services/notificationService');
const logger = require('../config/logger');

async function runWeeklyReport() {
  try {
    logger.info('[WeeklyReport] Generating weekly AI performance report...');

    const session = await BudgetSession.findOne({ sessionKey: 'global' });
    const summary = await getSummary('7d');

    if (summary.totalTrades === 0) {
      logger.info('[WeeklyReport] No trades in the last 7 days — skipping report.');
      return;
    }

    const {
      winCount, lossCount, totalTrades, winRate,
      totalPnl, totalProfit, totalLoss,
      startingBalance, currentBalance, maxDrawdown, avgDurationMinutes,
    } = summary;

    const balanceChange = currentBalance - startingBalance;
    const balancePct    = startingBalance > 0
      ? ((balanceChange / startingBalance) * 100).toFixed(1)
      : '0';
    const sign = totalPnl >= 0 ? '+' : '';
    const budget = session?.budget ?? startingBalance;

    const title = 'Weekly AI Trading Report';
    const body  = `This week: ${winCount}W/${lossCount}L · ${winRate}% WR · P&L ${sign}$${Math.abs(totalPnl).toFixed(2)}`;

    const users = await User.find({ isActive: true }).lean();
    let notified = 0;

    for (const user of users) {
      try {
        if (user.preferences?.fcmEnabled !== false && user.fcmToken) {
          await sendPushToUser(user._id, title, body, {
            type:    'WEEKLY_REPORT',
            wins:    String(winCount),
            losses:  String(lossCount),
            winRate: String(winRate),
            pnl:     String(totalPnl.toFixed(2)),
          }).catch(() => {});
          notified++;
        }

        if (user.preferences?.telegramEnabled && user.telegramChatId) {
          const tgMsg = _buildWeeklyTelegramReport({
            winCount, lossCount, totalTrades, winRate,
            totalPnl, totalProfit, totalLoss,
            balanceChange, balancePct, budget,
            maxDrawdown, avgDurationMinutes,
          });
          await sendTelegramMessage(user.telegramChatId, tgMsg).catch(() => {});
        }
      } catch (_) {}
    }

    const adminChannel = process.env.TELEGRAM_CHANNEL_ID;
    if (adminChannel) {
      const tgMsg = _buildWeeklyTelegramReport({
        winCount, lossCount, totalTrades, winRate,
        totalPnl, totalProfit, totalLoss,
        balanceChange, balancePct, budget,
        maxDrawdown, avgDurationMinutes,
      });
      await sendTelegramMessage(adminChannel, tgMsg).catch(() => {});
    }

    logger.info(`[WeeklyReport] Sent to ${notified} users — ${winCount}W/${lossCount}L | P&L: ${sign}$${Math.abs(totalPnl).toFixed(2)}`);
  } catch (err) {
    logger.error('[WeeklyReport] Error:', err.message);
  }
}

function _buildWeeklyTelegramReport({ winCount, lossCount, totalTrades, winRate, totalPnl, totalProfit, totalLoss, balanceChange, balancePct, budget, maxDrawdown, avgDurationMinutes }) {
  const esc  = (t) => String(t).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, c => '\\' + c);
  const sign = totalPnl >= 0 ? '+' : '';
  const bSign = balanceChange >= 0 ? '+' : '';
  return [
    `📊 *Weekly AI Trading Report*`,
    '',
    `📅 Last 7 days performance:`,
    `✅ Wins:    ${esc(winCount)}`,
    `❌ Losses:  ${esc(lossCount)}`,
    `📈 Win Rate: ${esc(winRate)}%`,
    `💰 P&L: ${esc(sign + '$' + Math.abs(totalPnl).toFixed(2))}`,
    `   Profit: \\+$${esc(totalProfit.toFixed(2))} | Loss: \\-$${esc(totalLoss.toFixed(2))}`,
    `📉 Max Drawdown: ${esc(maxDrawdown)}%`,
    `⏱ Avg trade duration: ${esc(avgDurationMinutes)} min`,
    '',
    `_${esc(totalTrades)} closed trade${totalTrades !== 1 ? 's' : ''} over 7 days_`,
  ].join('\n');
}

function startWeeklyReportJob() {
  // Every Monday at 08:00 UTC
  cron.schedule('0 8 * * 1', runWeeklyReport, { timezone: 'UTC' });
  logger.info('[WeeklyReport] Weekly report job scheduled — Mondays at 08:00 UTC');
}

module.exports = { startWeeklyReportJob, runWeeklyReport };
