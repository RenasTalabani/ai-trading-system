const NewsData = require('../models/NewsData');
const { collectNews, getNewsForAsset: fetchForAsset, getHighImpactNews: fetchHighImpact } = require('../services/newsService');
const logger = require('../config/logger');

exports.getLatestNews = async (req, res, next) => {
  try {
    const { limit = 30, page = 1, sentiment, source, event } = req.query;
    const filter = {};
    if (sentiment) filter['sentiment.label'] = sentiment;
    if (source)    filter.source = source;
    if (event)     filter.events = event;

    const skip = (Number(page) - 1) * Number(limit);
    const [news, total] = await Promise.all([
      NewsData.find(filter)
        .sort({ publishedAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .select('-__v'),
      NewsData.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      news,
    });
  } catch (err) {
    next(err);
  }
};

exports.getNewsForAsset = async (req, res, next) => {
  try {
    const asset = req.params.asset.toUpperCase();
    const { hours = 24, limit = 20 } = req.query;
    const news = await fetchForAsset(asset, Number(hours), Number(limit));
    res.status(200).json({ success: true, asset, count: news.length, news });
  } catch (err) {
    next(err);
  }
};

exports.getHighImpactNews = async (req, res, next) => {
  try {
    const { hours = 6, limit = 10 } = req.query;
    const news = await fetchHighImpact(Number(hours), Number(limit));
    res.status(200).json({ success: true, count: news.length, news });
  } catch (err) {
    next(err);
  }
};

exports.getNewsStats = async (req, res, next) => {
  try {
    const since24h = new Date(Date.now() - 24 * 3600000);

    const [total, bySentiment, byImpact, byEvent] = await Promise.all([
      NewsData.countDocuments({ publishedAt: { $gte: since24h } }),
      NewsData.aggregate([
        { $match: { publishedAt: { $gte: since24h } } },
        { $group: { _id: '$sentiment.label', count: { $sum: 1 }, avgScore: { $avg: '$sentiment.score' } } },
      ]),
      NewsData.aggregate([
        { $match: { publishedAt: { $gte: since24h } } },
        { $group: { _id: '$impact.level', count: { $sum: 1 } } },
      ]),
      NewsData.aggregate([
        { $match: { publishedAt: { $gte: since24h }, events: { $ne: [] } } },
        { $unwind: '$events' },
        { $group: { _id: '$events', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
    ]);

    res.status(200).json({
      success: true,
      period: '24h',
      stats: {
        total,
        bySentiment: bySentiment.reduce((acc, s) => {
          acc[s._id] = { count: s.count, avgScore: Math.round(s.avgScore * 1000) / 1000 };
          return acc;
        }, {}),
        byImpact: byImpact.reduce((acc, i) => { acc[i._id] = i.count; return acc; }, {}),
        topEvents: byEvent.map((e) => ({ event: e._id, count: e.count })),
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.triggerCollection = async (req, res, next) => {
  try {
    logger.info(`[NewsController] Manual collection triggered by admin ${req.user._id}`);
    setImmediate(() =>
      collectNews().catch((e) => logger.error('Manual news collection error:', e.message))
    );
    res.status(202).json({ success: true, message: 'News collection started in background.' });
  } catch (err) {
    next(err);
  }
};
