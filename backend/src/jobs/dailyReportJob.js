/**
 * Daily Report Job — runs every day at 08:00 UTC.
 * Reports actual virtual trade performance from the past 24 h.
 */
const cron = require('node-cron');
const { getSummary } = require('../services/virtualTrackingService');
const BudgetSession  = require('../models/BudgetSession');
const User           = require('../models/User');
const { sendPushToUser, sendTelegramMessage } = require('../services/notificationService');
const logger = require('../config/logger');

async function runDailyReport() {
  try {
    logger.info('[DailyReport] Generating daily AI performance report...');

    const session = await BudgetSession.findOne({ sessionKey: 'global' });
    const summary = await getSummary('1d');

    if (summary.totalTrades === 0) {
      logger.info('[DailyReport] No trades in the last 24 h — skipping report.');
      return;
    }

    const { winCount, lossCount, totalTrades, winRate, totalPnl, totalProfit, totalLoss } = summary;
    const sign    = totalPnl >= 0 ? '+' : '';
    const budget  = session?.budget ?? summary.startingBalance;

    const title = 'Daily AI Trading Report';
    const body  = `Today: ${winCount}W/${lossCount}L · ${winRate}% WR · P&L ${sign}$${Math.abs(totalPnl).toFixed(2)}`;

    const users = await User.find({ isActive: true }).lean();
    let notified = 0;

    for (const user of users) {
      try {
        if (user.preferences?.fcmEnabled !== false && user.fcmToken) {
          await sendPushToUser(user._id, title, body, {
            type:    'DAILY_REPORT',
            wins:    String(winCount),
            losses:  String(lossCount),
            winRate: String(winRate),
            pnl:     String(totalPnl.toFixed(2)),
          }).catch(() => {});
          notified++;
        }

        if (user.preferences?.telegramEnabled && user.telegramChatId) {
          const tgMsg = _buildTelegramReport('Daily', {
            winCount, lossCount, totalTrades, winRate,
            totalPnl, totalProfit, totalLoss, budget,
          });
          await sendTelegramMessage(user.telegramChatId, tgMsg).catch(() => {});
        }
      } catch (_) {}
    }

    const adminChannel = process.env.TELEGRAM_CHANNEL_ID;
    if (adminChannel) {
      const tgMsg = _buildTelegramReport('Daily', {
        winCount, lossCount, totalTrades, winRate,
        totalPnl, totalProfit, totalLoss, budget,
      });
      await sendTelegramMessage(adminChannel, tgMsg).catch(() => {});
    }

    logger.info(`[DailyReport] Sent to ${notified} users — ${winCount}W/${lossCount}L | P&L: ${sign}$${Math.abs(totalPnl).toFixed(2)}`);
  } catch (err) {
    logger.error('[DailyReport] Error:', err.message);
  }
}

function _buildTelegramReport(period, { winCount, lossCount, totalTrades, winRate, totalPnl, totalProfit, totalLoss, budget }) {
  const esc  = (t) => String(t).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, c => '\\' + c);
  const sign = totalPnl >= 0 ? '+' : '';
  return [
    `📊 *${period} AI Trading Report*`,
    '',
    `✅ Wins:    ${esc(winCount)}`,
    `❌ Losses:  ${esc(lossCount)}`,
    `📈 Win Rate: ${esc(winRate)}%`,
    `💰 P&L: ${esc(sign + '$' + Math.abs(totalPnl).toFixed(2))}`,
    `   Profit: \\+$${esc(totalProfit.toFixed(2))} | Loss: \\-$${esc(totalLoss.toFixed(2))}`,
    '',
    `_${esc(totalTrades)} closed trade${totalTrades !== 1 ? 's' : ''} in past ${period === 'Daily' ? '24h' : '7 days'}_`,
  ].join('\n');
}

function startDailyReportJob() {
  cron.schedule('0 8 * * *', runDailyReport, { timezone: 'UTC' });
  logger.info('[DailyReport] Daily report job scheduled at 08:00 UTC');
}

module.exports = { startDailyReportJob, runDailyReport };
