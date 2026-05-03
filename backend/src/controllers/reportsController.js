const { query, validationResult } = require('express-validator');
const AIReport = require('../models/AIReport');
const { generateHourlyReport } = require('../jobs/hourlyReportJob');
const logger   = require('../config/logger');

exports.latest = async (req, res) => {
  try {
    const type   = req.query.type || 'hourly';
    const report = await AIReport.findOne({ type }).sort({ createdAt: -1 }).lean();
    if (!report) return res.json({ success: true, report: null, message: 'No reports yet' });
    res.json({ success: true, report });
  } catch (err) {
    logger.error('[Reports] latest error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.history = [
  query('type').optional().isIn(['hourly', 'daily', 'weekly']),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),

  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const type  = req.query.type  || 'hourly';
    const page  = req.query.page  || 1;
    const limit = req.query.limit || 24;
    const skip  = (page - 1) * limit;

    try {
      const [reports, total] = await Promise.all([
        AIReport.find({ type }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        AIReport.countDocuments({ type }),
      ]);
      res.json({ success: true, total, page, pages: Math.ceil(total / limit), reports });
    } catch (err) {
      logger.error('[Reports] history error:', err.message);
      res.status(500).json({ success: false, message: err.message });
    }
  },
];

exports.trigger = async (req, res) => {
  try {
    const report = await generateHourlyReport();
    if (!report) return res.json({ success: false, message: 'No signals available to generate report' });
    res.json({ success: true, report });
  } catch (err) {
    logger.error('[Reports] trigger error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.stats = async (req, res) => {
  try {
    const [hourlyCount, dailyCount] = await Promise.all([
      AIReport.countDocuments({ type: 'hourly' }),
      AIReport.countDocuments({ type: 'daily' }),
    ]);

    const latest = await AIReport.findOne().sort({ createdAt: -1 }).lean();
    const moods  = await AIReport.aggregate([
      { $group: { _id: '$marketSummary.marketMood', count: { $sum: 1 } } },
    ]);

    res.json({
      success: true,
      counts:  { hourly: hourlyCount, daily: dailyCount },
      latestAt: latest?.createdAt || null,
      moodDistribution: moods,
    });
  } catch (err) {
    logger.error('[Reports] stats error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
