const cron = require('node-cron');
const Signal = require('../models/Signal');
const aiService = require('../services/aiService');
const notificationService = require('../services/notificationService');
const { broadcastSignal } = require('../websocket/wsServer');
const { TRACKED_ASSETS } = require('../services/binanceService');
const logger = require('../config/logger');

// Non-Binance assets (routed by the AI service through Yahoo Finance) that
// still go through the same predict → signal → notification pipeline.
const EXTENDED_ASSETS = ['XAUUSD'];

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

    const { direction, raw_confidence } = prediction;
    // Use raw_confidence — calibrated value is unreliable when calibrator is untrained
    const confidence = raw_confidence ?? prediction.confidence;

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
      // T-066: ai-service's /predict already returns `decision` (T-065) --
      // was being discarded here. Falls back to `direction` if an older
      // ai-service build doesn't send it yet, so this never persists
      // undefined for a field that has an enum constraint.
      decision: prediction.decision || direction,
      price: {
        entry: prediction.entry_price,
        stopLoss: prediction.stop_loss,
        takeProfit: prediction.take_profit,
      },
      reason: prediction.reason,
      sources: prediction.sources,
      // T-078: audit trail for how `confidence` above was derived --
      // undefined (not persisted) on an older ai-service build that
      // doesn't send this field yet, same fallback pattern as `decision`.
      confidenceTrace: prediction.confidence_trace,
    });

    logger.info(`[SignalJob] NEW SIGNAL: ${asset} ${direction} | Confidence: ${confidence}%`);

    // Broadcast to WebSocket clients
    broadcastSignal(signal);

    // Send notifications
    await notificationService.sendSignalNotification(signal);

    return signal;
  } catch (err) {
    logger.error(`[SignalJob] Error processing ${asset}: ${err.stack}`);
    return null;
  }
}

async function runSignalGeneration() {
  if (signalCount >= MAX_SIGNALS_PER_HOUR()) {
    logger.warn(`[SignalJob] Max signals per hour (${MAX_SIGNALS_PER_HOUR()}) reached. Skipping.`);
    return;
  }

  const assets = [...TRACKED_ASSETS, ...EXTENDED_ASSETS];
  logger.info(`[SignalJob] Running signal generation for ${assets.length} assets...`);
  let generated = 0;

  for (const asset of assets) {
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

// T-030 (2026-08-18, PM continuous-improvement pass): this is directly
// registered as a cron.schedule() callback (hourly) with no try/catch of
// its own. node-cron catches an async task's rejection internally so this
// was never a crash risk (confirmed by reading node-cron's source during
// T-024), but nothing here listens for node-cron's 'task-failed' event
// either -- so if Signal.updateMany ever threw (a transient DB blip, say),
// the error would vanish with zero log trace, same class of silent-failure
// gap T-024 closed for notificationRetryJob.js. That earlier pass checked
// try/catch presence per *file*, not per scheduled function, so this one
// (in a file that already had a try/catch elsewhere, in processAsset)
// slipped through. Wrapped to match every other scheduled job function.
async function expireOldSignals() {
  try {
    const result = await Signal.updateMany(
      { status: 'active', expiresAt: { $lt: new Date() } },
      { $set: { status: 'expired' } }
    );
    if (result.modifiedCount > 0) {
      logger.info(`[SignalJob] Expired ${result.modifiedCount} old signals.`);
    }
  } catch (err) {
    logger.error(`[SignalJob] expireOldSignals error: ${err.stack}`);
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

module.exports = { startSignalJob, runSignalGeneration, expireOldSignals };
