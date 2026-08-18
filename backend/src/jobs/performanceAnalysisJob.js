/**
 * performanceAnalysisJob — runs every 6 hours.
 * Analyses recent WIN/LOSS decisions, pushes RL weight updates
 * to the Python AI service, and logs a performance summary.
 */
const cron   = require('node-cron');
const axios  = require('axios');
const logger = require('../config/logger');
const AIDecision      = require('../models/AIDecision');
const SignalWeights   = require('../models/SignalWeights');
const MarketRegimeHistory = require('../models/MarketRegimeHistory');

const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

async function runPerformanceAnalysis() {
  try {
    logger.info('[PerfAnalysis] Starting 6-hour performance analysis…');

    const since = new Date(Date.now() - 6 * 3600_000);

    // Fetch recent closed decisions
    const recent = await AIDecision.find({
      result:    { $in: ['WIN', 'LOSS'] },
      closedAt:  { $gte: since },
      fusedScore: { $ne: null },
    }).lean();

    if (recent.length === 0) {
      logger.info('[PerfAnalysis] No new closed trades — skipping weight update.');
      return;
    }

    const wins   = recent.filter(d => d.result === 'WIN').length;
    const losses = recent.filter(d => d.result === 'LOSS').length;
    const winRate = Math.round((wins / recent.length) * 100);

    logger.info(`[PerfAnalysis] ${recent.length} trades — W:${wins} L:${losses} (${winRate}% WR)`);

    // Push each outcome to the AI service RL engine
    let pushed = 0;
    for (const dec of recent) {
      try {
        // Estimate signal contributions from stored fields
        const techContrib   = dec.fusedScore  ? Math.min(0.70, dec.fusedScore  / 100) : 0.45;
        const newsContrib   = dec.newsScore   ? Math.min(0.40, dec.newsScore   / 100) : 0.20;
        const macroContrib  = 0.20;
        const socialContrib = Math.max(0.05, 1 - techContrib - newsContrib - macroContrib);

        await axios.post(`${AI_URL}/api/rl/outcome`, {
          result:            dec.result,
          technical_contrib: parseFloat(techContrib.toFixed(3)),
          news_contrib:      parseFloat(newsContrib.toFixed(3)),
          social_contrib:    parseFloat(socialContrib.toFixed(3)),
          macro_contrib:     parseFloat(macroContrib.toFixed(3)),
        }, { timeout: 10_000 });

        pushed++;
      } catch (_) {}
    }

    // Fetch updated weights from AI service and store in MongoDB
    try {
      const { data } = await axios.get(`${AI_URL}/api/rl/weights`, { timeout: 8_000 });
      if (data?.weights) {
        await SignalWeights.findOneAndUpdate(
          { weightsKey: 'global' },
          {
            $set: {
              technical:    data.weights.technical,
              news:         data.weights.news,
              social:       data.weights.social,
              macro:        data.weights.macro,
              totalUpdates: data.total_updates || 0,
              lastResult:   recent.at(-1)?.result || null,
              updatedAt:    new Date(),
            },
          },
          { upsert: true },
        );
        logger.info(`[PerfAnalysis] Weights synced → tech=${data.weights.technical} news=${data.weights.news} social=${data.weights.social} macro=${data.weights.macro}`);
      }
    } catch (err) {
      logger.warn('[PerfAnalysis] Could not sync weights from AI service:', err.message);
    }

    // Log regime performance summary
    const regimeSummary = await MarketRegimeHistory.aggregate([
      { $match: { result: { $in: ['WIN', 'LOSS'] }, recordedAt: { $gte: since } } },
      { $group: {
        _id:    '$regime',
        wins:   { $sum: { $cond: [{ $eq: ['$result', 'WIN']  }, 1, 0] } },
        losses: { $sum: { $cond: [{ $eq: ['$result', 'LOSS'] }, 1, 0] } },
      }},
    ]);

    if (regimeSummary.length > 0) {
      const lines = regimeSummary.map(r =>
        `${r._id}: ${r.wins}W/${r.losses}L`
      ).join(' | ');
      logger.info(`[PerfAnalysis] Regime WR last 6h — ${lines}`);
    }

    logger.info(`[PerfAnalysis] Complete — ${pushed}/${recent.length} outcomes pushed to RL engine.`);
  } catch (err) {
    logger.error(`[PerfAnalysis] Error: ${err.stack}`);
  }
}

function start() {
  runPerformanceAnalysis();
  cron.schedule('0 */6 * * *', runPerformanceAnalysis);
  logger.info('[PerfAnalysis] Scheduled — runs every 6 hours');
}

module.exports = { start, runPerformanceAnalysis };
