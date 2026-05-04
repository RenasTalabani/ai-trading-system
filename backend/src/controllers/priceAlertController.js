const PriceAlert = require('../models/PriceAlert');
const logger     = require('../config/logger');

// GET /api/v1/price-alerts
exports.list = async (req, res) => {
  try {
    const alerts = await PriceAlert.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, alerts });
  } catch (err) {
    logger.error('[PriceAlert] list error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/v1/price-alerts
exports.create = async (req, res) => {
  try {
    const { asset, displayName, targetPrice, direction, note } = req.body;
    if (!asset || !targetPrice || !direction) {
      return res.status(400).json({ success: false, message: 'asset, targetPrice and direction are required' });
    }
    if (!['above', 'below'].includes(direction)) {
      return res.status(400).json({ success: false, message: 'direction must be above or below' });
    }
    const alert = await PriceAlert.create({
      userId: req.user._id,
      asset:  asset.toUpperCase(),
      displayName: displayName || asset,
      targetPrice: parseFloat(targetPrice),
      direction,
      note: note || '',
    });
    res.status(201).json({ success: true, alert });
  } catch (err) {
    logger.error('[PriceAlert] create error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/v1/price-alerts/:id
exports.remove = async (req, res) => {
  try {
    const alert = await PriceAlert.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });
    if (!alert) return res.status(404).json({ success: false, message: 'Alert not found' });
    res.json({ success: true });
  } catch (err) {
    logger.error('[PriceAlert] delete error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/v1/price-alerts/:id/toggle
exports.toggle = async (req, res) => {
  try {
    const alert = await PriceAlert.findOne({ _id: req.params.id, userId: req.user._id });
    if (!alert) return res.status(404).json({ success: false, message: 'Alert not found' });
    alert.active = !alert.active;
    await alert.save();
    res.json({ success: true, active: alert.active });
  } catch (err) {
    logger.error('[PriceAlert] toggle error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
