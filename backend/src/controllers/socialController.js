const SocialData = require('../models/SocialData');
const { fetchSocialAlerts, getSocialSentimentForAsset } = require('../services/socialService');

exports.getSocialFeed = async (req, res, next) => {
  try {
    const { platform, sentiment, limit = 30, page = 1 } = req.query;
    const filter = { 'flags.isSpam': false };
    if (platform)  filter.platform = platform;
    if (sentiment) filter['sentiment.label'] = sentiment;

    const skip = (Number(page) - 1) * Number(limit);
    const [posts, total] = await Promise.all([
      SocialData.find(filter)
        .sort({ publishedAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .select('-__v'),
      SocialData.countDocuments(filter),
    ]);

    res.status(200).json({ success: true, total, page: Number(page), posts });
  } catch (err) {
    next(err);
  }
};

exports.getSocialForAsset = async (req, res, next) => {
  try {
    const asset = req.params.asset.toUpperCase();
    const { hours = 6 } = req.query;
    const data = await getSocialSentimentForAsset(asset, Number(hours));
    res.status(200).json({ success: true, asset, ...data });
  } catch (err) {
    next(err);
  }
};

exports.getSocialAlerts = async (req, res, next) => {
  try {
    const alerts = await fetchSocialAlerts();
    res.status(200).json(alerts || { success: true, alert_count: 0, alerts: [] });
  } catch (err) {
    next(err);
  }
};

exports.getSocialStats = async (req, res, next) => {
  try {
    const since = new Date(Date.now() - 24 * 3600000);
    const [total, byPlatform, bySentiment] = await Promise.all([
      SocialData.countDocuments({ publishedAt: { $gte: since } }),
      SocialData.aggregate([
        { $match: { publishedAt: { $gte: since } } },
        { $group: { _id: '$platform', count: { $sum: 1 } } },
      ]),
      SocialData.aggregate([
        { $match: { publishedAt: { $gte: since } } },
        { $group: { _id: '$sentiment.label', count: { $sum: 1 }, avgScore: { $avg: '$sentiment.score' } } },
      ]),
    ]);

    res.status(200).json({
      success: true,
      period: '24h',
      stats: {
        total,
        byPlatform: byPlatform.reduce((a, p) => { a[p._id] = p.count; return a; }, {}),
        bySentiment: bySentiment.reduce((a, s) => {
          a[s._id] = { count: s.count, avgScore: Math.round(s.avgScore * 1000) / 1000 };
          return a;
        }, {}),
      },
    });
  } catch (err) {
    next(err);
  }
};
