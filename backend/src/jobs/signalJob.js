const cron = require('node-cron');
const Signal = require('../models/Signal');
const aiService = require('../services/aiService');
const notificationService = require('../services/notificationService');
const { broadcastSignal } = require('../websocket/wsServer');
const { TRACKED_ASSETS } = require('../services/binanceService');
const logger = require('../config/logger');

const CONFIDENCE_THRESHOLD = () => parseInt(process.env.SIGNAL_CONFIDENCE_THRESHOLD) || 70;
const MAX_SIGNALS_PER_HOUR = () => parseInt(process.env.MAX_SIGNALS_PER_HOUR) || 10;

let signalCount = 0;
let signalCountResetTimer = null;

function resetSignalCount() {
  signalCount = 0;
}

async function isDuplicateSignal(asset, direction) {
  const recent = await Signal.findOne({
    asset,
    direction,
    status: 'active',
    createdAt: { $gte: new Date(Date.now() - 4 * 60 * 60 * 1000) }, // 4h window
  });
  return !!recent;
}

async function processAsset(asset) {
  try {
    const prediction = await aiService.generatePrediction(asset);
    if (!prediction) return null;

    const { direction, confidence } = prediction;

    if (direction === 'HOLD') return null;
    if (confidence < CONFIDENCE_THRESHOLD()) {
      logger.debug(`[SignalJob] ${asset} skipped — confidence ${confidence}% below threshold`);
      return null;
    }

    if (await isDuplicateSignal(asset, direction)) {
      logger.debug(`[SignalJob] ${asset} ${direction} — duplicate signal suppressed`);
      return null;
    }

    const signal = await Signal.create({
      asset: prediction.asset,
      direction,
      confidence,
      price: {
        entry: prediction.entry_price,
        stopLoss: prediction.stop_loss,
        takeProfit: prediction.take_profit,
      },
      reason: prediction.reason,
      sources: prediction.sources,
    });

    logger.info(`[SignalJob] NEW SIGNAL: ${asset} ${direction} | Confidence: ${confidence}%`);

    // Broadcast to WebSocket clients
    broadcastSignal(signal);

    // Send notifications
    await notificationService.sendSignalNotification(signal);

    return signal;
  } catch (err) {
    logger.error(`[SignalJob] Error processing ${asset}:`, err.message);
    return null;
  }
}

async function runSignalGeneration() {
  if (signalCount >= MAX_SIGNALS_PER_HOUR()) {
    logger.warn(`[SignalJob] Max signals per hour (${MAX_SIGNALS_PER_HOUR()}) reached. Skipping.`);
    return;
  }

  logger.info(`[SignalJob] Running signal generation for ${TRACKED_ASSETS.length} assets...`);
  let generated = 0;

  for (const asset of TRACKED_ASSETS) {
    const signal = await processAsset(asset);
    if (signal) {
      generated++;
      signalCount++;
      // Throttle: small delay between assets
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  logger.info(`[SignalJob] Round complete. Generated ${generated} new signals.`);
}

async function expireOldSignals() {
  const result = await Signal.updateMany(
    { status: 'active', expiresAt: { $lt: new Date() } },
    { $set: { status: 'expired' } }
  );
  if (result.modifiedCount > 0) {
    logger.info(`[SignalJob] Expired ${result.modifiedCount} old signals.`);
  }
}

function startSignalJob() {
  logger.info('Starting signal generation jobs...');

  // Generate signals every 15 minutes
  cron.schedule('*/15 * * * *', runSignalGeneration);

  // Expire old signals every hour
  cron.schedule('0 * * * *', expireOldSignals);

  // Reset hourly signal counter
  signalCountResetTimer = cron.schedule('0 * * * *', resetSignalCount);

  logger.info('  Signal generation: every 15 minutes');
  logger.info('  Signal expiry cleanup: every hour');

  // First run after 10s (allow DB to seed first)
  setTimeout(runSignalGeneration, 10000);
}

module.exports = { startSignalJob, runSignalGeneration };
