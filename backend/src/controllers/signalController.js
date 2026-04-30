const Signal = require('../models/Signal');
const aiService = require('../services/aiService');
const notificationService = require('../services/notificationService');
const { broadcastSignal } = require('../websocket/wsServer');
const { runSignalGeneration } = require('../jobs/signalJob');
const logger = require('../config/logger');

exports.getSignals = async (req, res, next) => {
  try {
    const { asset, direction, minConfidence = 0, status, limit = 20, page = 1 } = req.query;
    const filter = {};
    // Default: last 24 h regardless of status so dashboard never looks empty
    if (status) {
      filter.status = status;
    } else {
      filter.createdAt = { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) };
    }
    if (asset) filter.asset = asset.toUpperCase();
    if (direction) filter.direction = direction.toUpperCase();
    if (minConfidence) filter.confidence = { $gte: Number(minConfidence) };

    const skip = (Number(page) - 1) * Number(limit);
    const [signals, total] = await Promise.all([
      Signal.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Signal.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      signals,
    });
  } catch (err) {
    next(err);
  }
};

exports.getLatestSignals = async (req, res, next) => {
  try {
    const threshold = parseInt(process.env.SIGNAL_CONFIDENCE_THRESHOLD) || 70;
    const signals = await Signal.find({
      status: 'active',
      confidence: { $gte: threshold },
    })
      .sort({ createdAt: -1 })
      .limit(10);

    res.status(200).json({ success: true, signals });
  } catch (err) {
    next(err);
  }
};

exports.getSignalById = async (req, res, next) => {
  try {
    const signal = await Signal.findById(req.params.id);
    if (!signal) {
      return res.status(404).json({ success: false, message: 'Signal not found.' });
    }
    res.status(200).json({ success: true, signal });
  } catch (err) {
    next(err);
  }
};

exports.getSignalStats = async (req, res, next) => {
  try {
    const [total, active, byDirection] = await Promise.all([
      Signal.countDocuments(),
      Signal.countDocuments({ status: 'active' }),
      Signal.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$direction', count: { $sum: 1 }, avgConfidence: { $avg: '$confidence' } } },
      ]),
    ]);

    const avgConfidence = await Signal.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: null, avg: { $avg: '$confidence' } } },
    ]);

    res.status(200).json({
      success: true,
      stats: {
        total,
        active,
        avgConfidence: avgConfidence[0]?.avg ? Math.round(avgConfidence[0].avg * 10) / 10 : 0,
        byDirection: byDirection.reduce((acc, d) => {
          acc[d._id] = { count: d.count, avgConfidence: Math.round(d.avgConfidence * 10) / 10 };
          return acc;
        }, {}),
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.generateSignal = async (req, res, next) => {
  try {
    const { asset } = req.body;
    if (!asset) {
      return res.status(400).json({ success: false, message: 'Asset symbol is required.' });
    }

    logger.info(`Manual signal generation for: ${asset} by user ${req.user._id}`);
    const prediction = await aiService.generatePrediction(asset.toUpperCase());

    if (!prediction) {
      return res.status(502).json({ success: false, message: 'AI service did not return a prediction.' });
    }

    const signal = await Signal.create({
      asset: prediction.asset,
      direction: prediction.direction,
      confidence: prediction.confidence,
      price: {
        entry: prediction.entry_price,
        stopLoss: prediction.stop_loss,
        takeProfit: prediction.take_profit,
      },
      reason: prediction.reason,
      sources: prediction.sources,
    });

    broadcastSignal(signal);

    if (signal.confidence >= (parseInt(process.env.SIGNAL_CONFIDENCE_THRESHOLD) || 70)) {
      await notificationService.sendSignalNotification(signal);
    }

    res.status(201).json({ success: true, signal });
  } catch (err) {
    next(err);
  }
};

exports.runSignalScan = async (req, res, next) => {
  try {
    logger.info(`Full signal scan triggered by admin ${req.user._id}`);
    // Run in background — don't block the HTTP response
    setImmediate(() => runSignalGeneration().catch((e) => logger.error('Signal scan error:', e.message)));
    res.status(202).json({ success: true, message: 'Signal scan started. Results will be broadcast via WebSocket.' });
  } catch (err) {
    next(err);
  }
};
