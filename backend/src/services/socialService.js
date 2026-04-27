const axios = require('axios');
const SocialData = require('../models/SocialData');
const aiService = require('./aiService');
const logger = require('../config/logger');

const ASSET_KEYWORDS = {
  BTCUSDT:  ['bitcoin', 'btc'],
  ETHUSDT:  ['ethereum', 'eth'],
  BNBUSDT:  ['binance', 'bnb'],
  SOLUSDT:  ['solana', 'sol'],
  XRPUSDT:  ['ripple', 'xrp'],
  ADAUSDT:  ['cardano', 'ada'],
  DOGEUSDT: ['dogecoin', 'doge'],
  AVAXUSDT: ['avalanche', 'avax'],
  LINKUSDT: ['chainlink', 'link'],
  MATICUSDT:['polygon', 'matic'],
};

function detectRelatedAssets(text) {
  const lower = text.toLowerCase();
  return Object.entries(ASSET_KEYWORDS)
    .filter(([, kws]) => kws.some((k) => lower.includes(k)))
    .map(([a]) => a);
}

async function fetchSocialAnalysis() {
  try {
    const resp = await axios.get(`${process.env.AI_SERVICE_URL}/api/social/analysis`, { timeout: 20000 });
    return resp.data;
  } catch (err) {
    logger.error('[SocialService] AI service social analysis failed:', err.message);
    return null;
  }
}

async function fetchSocialAlerts() {
  try {
    const resp = await axios.get(`${process.env.AI_SERVICE_URL}/api/social/alerts`, { timeout: 10000 });
    return resp.data;
  } catch (err) {
    logger.error('[SocialService] Social alerts fetch failed:', err.message);
    return null;
  }
}

async function storeSocialPosts(posts) {
  if (!posts || !posts.length) return { stored: 0, skipped: 0 };
  let stored = 0, skipped = 0;

  for (const post of posts) {
    try {
      const relatedAssets = detectRelatedAssets(post.content || '');
      await SocialData.create({
        platform:       post.platform,
        content:        post.content?.slice(0, 1000) || '',
        author:         post.author || 'anonymous',
        authorFollowers:post.author_followers || 0,
        channel:        post.channel || '',
        sentiment: {
          label:      post.sentiment || 'neutral',
          score:      post.compound || 0,
          confidence: post.confidence || 0,
        },
        relatedAssets,
        flags: {
          isSpam:         post.is_spam || false,
          isHype:         post.is_hype || false,
          isFear:         post.is_fear || false,
          isManipulation: post.is_manipulation || false,
          isInfluencer:   post.is_influencer || false,
        },
        influence: {
          score:  Math.round((post.weight || 1) * 33),
          weight: post.weight || 1,
        },
        engagements: {
          likes:   post.likes || 0,
          shares:  post.shares || 0,
          replies: post.replies || 0,
        },
        publishedAt: post.published_at ? new Date(post.published_at) : new Date(),
      });
      stored++;
    } catch (err) {
      skipped++;
    }
  }
  return { stored, skipped };
}

async function getSocialSentimentForAsset(asset, hours = 6) {
  const since = new Date(Date.now() - hours * 3600000);
  const posts = await SocialData.find({
    relatedAssets: asset,
    publishedAt: { $gte: since },
    'flags.isSpam': false,
  }).sort({ 'influence.weight': -1 }).limit(50);

  if (!posts.length) return { sentiment: 'neutral', score: 0, count: 0 };

  const total = posts.reduce((sum, p) => sum + (p.sentiment?.score || 0), 0);
  const avg   = total / posts.length;
  return {
    sentiment: avg > 0.05 ? 'bullish' : avg < -0.05 ? 'bearish' : 'neutral',
    score: Math.round(avg * 1000) / 1000,
    count: posts.length,
  };
}

module.exports = { fetchSocialAnalysis, fetchSocialAlerts, storeSocialPosts, getSocialSentimentForAsset };
