const axios = require('axios');
const NewsData = require('../models/NewsData');
const aiService = require('./aiService');
const logger = require('../config/logger');

// ─── RSS Feed Sources ──────────────────────────────────────────────────────────
const RSS_FEEDS = [
  { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=BTC-USD&region=US&lang=en-US', source: 'Yahoo Finance' },
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'CoinDesk' },
  { url: 'https://cointelegraph.com/rss', source: 'CoinTelegraph' },
  { url: 'https://decrypt.co/feed', source: 'Decrypt' },
  { url: 'https://feeds.reuters.com/reuters/businessNews', source: 'Reuters Business' },
  { url: 'https://feeds.bloomberg.com/markets/news.rss', source: 'Bloomberg Markets' },
  { url: 'https://www.investing.com/rss/news.rss', source: 'Investing.com' },
  { url: 'https://www.forexlive.com/feed/news', source: 'ForexLive' },
  { url: 'https://cryptopanic.com/news/rss/', source: 'CryptoPanic' },
];

// ─── Asset keyword map ─────────────────────────────────────────────────────────
const ASSET_KEYWORDS = {
  BTCUSDT:  ['bitcoin', 'btc', 'satoshi', 'crypto'],
  ETHUSDT:  ['ethereum', 'eth', 'ether', 'defi', 'smart contract'],
  BNBUSDT:  ['binance', 'bnb', 'bsc'],
  SOLUSDT:  ['solana', 'sol'],
  XRPUSDT:  ['ripple', 'xrp'],
  ADAUSDT:  ['cardano', 'ada'],
  DOGEUSDT: ['dogecoin', 'doge', 'meme coin'],
  AVAXUSDT: ['avalanche', 'avax'],
  LINKUSDT: ['chainlink', 'link', 'oracle'],
  MATICUSDT:['polygon', 'matic'],
};

// ─── Simple XML/RSS parser (no external dependency) ───────────────────────────
function parseRSSItems(xml) {
  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))
             || block.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, 'i'));
      return m ? m[1].trim() : '';
    };

    const title = get('title');
    const link  = get('link') || get('guid');
    const pub   = get('pubDate') || get('published') || get('dc:date');
    const desc  = get('description') || get('summary') || get('content:encoded');

    if (title && link) {
      items.push({
        title,
        url: link,
        summary: desc.replace(/<[^>]+>/g, '').slice(0, 500),
        publishedAt: pub ? new Date(pub) : new Date(),
      });
    }
  }
  return items;
}

// ─── Detect related assets ─────────────────────────────────────────────────────
function detectRelatedAssets(text) {
  const lower = text.toLowerCase();
  return Object.entries(ASSET_KEYWORDS)
    .filter(([, kws]) => kws.some((kw) => lower.includes(kw)))
    .map(([asset]) => asset);
}

// ─── Fetch one RSS feed ────────────────────────────────────────────────────────
async function fetchFeed(feed) {
  try {
    const resp = await axios.get(feed.url, {
      timeout: 8000,
      headers: { 'User-Agent': 'AITradingBot/2.0 (news collector)' },
    });
    const items = parseRSSItems(resp.data);
    return items.map((item) => ({ ...item, source: feed.source }));
  } catch (err) {
    logger.debug(`Feed failed [${feed.source}]: ${err.message}`);
    return [];
  }
}

// ─── Main collector ───────────────────────────────────────────────────────────
async function collectNews() {
  logger.info('[NewsService] Starting news collection from all feeds...');
  const allItems = (await Promise.all(RSS_FEEDS.map(fetchFeed))).flat();

  if (!allItems.length) {
    logger.warn('[NewsService] No articles collected from any feed.');
    return { collected: 0, stored: 0, skipped: 0 };
  }

  logger.info(`[NewsService] Fetched ${allItems.length} raw articles. Analyzing sentiment...`);

  // Batch sentiment analysis via AI service
  const headlines = allItems.map((a) => a.title);
  const sentimentResult = await aiService.analyzeNews(headlines);

  let stored = 0;
  let skipped = 0;

  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    const itemSentiment = sentimentResult?.results?.[i] || null;
    const relatedAssets = detectRelatedAssets(item.title + ' ' + item.summary);

    try {
      await NewsData.updateOne(
        { url: item.url },
        {
          $setOnInsert: {
            title: item.title,
            summary: item.summary,
            url: item.url,
            source: item.source,
            publishedAt: item.publishedAt,
            relatedAssets,
            sentiment: itemSentiment
              ? {
                  label: itemSentiment.sentiment,
                  score: itemSentiment.compound,
                  confidence: itemSentiment.impact_score,
                  model: 'vader',
                }
              : {},
            impact: deriveImpact(item, itemSentiment),
            events: detectEvents(item.title + ' ' + item.summary),
            keywords: extractKeywords(item.title),
            processed: true,
          },
        },
        { upsert: true }
      );
      stored++;
    } catch (err) {
      if (err.code === 11000) { skipped++; } // duplicate URL
      else logger.debug(`[NewsService] Store error: ${err.message}`);
    }
  }

  logger.info(`[NewsService] Done: ${stored} new articles stored, ${skipped} duplicates skipped.`);
  return { collected: allItems.length, stored, skipped };
}

// ─── Event detection ───────────────────────────────────────────────────────────
const EVENT_PATTERNS = {
  interest_rate:    ['fed', 'federal reserve', 'interest rate', 'fomc', 'rate hike', 'rate cut', 'inflation', 'cpi'],
  regulation:       ['sec', 'regulation', 'ban', 'illegal', 'lawsuit', 'court', 'compliance', 'sanction'],
  hack_exploit:     ['hack', 'exploit', 'breach', 'stolen', 'vulnerability', 'attack', '0day', 'rug pull'],
  partnership:      ['partnership', 'collaboration', 'integration', 'deal', 'agreement', 'acquisition'],
  earnings:         ['earnings', 'revenue', 'profit', 'quarterly', 'q1', 'q2', 'q3', 'q4', 'annual report'],
  etf:              ['etf', 'exchange traded fund', 'blackrock', 'grayscale', 'spot bitcoin'],
  whale_movement:   ['whale', 'large transfer', 'exchange inflow', 'exchange outflow', 'cold wallet'],
  market_crash:     ['crash', 'collapse', 'plunge', 'bloodbath', 'bear market', 'capitulation'],
  rally:            ['rally', 'surge', 'all-time high', 'ath', 'bullrun', 'breakout', 'bull market'],
  macro:            ['gdp', 'unemployment', 'jobs report', 'treasury', 'dollar', 'recession'],
};

function detectEvents(text) {
  const lower = text.toLowerCase();
  return Object.entries(EVENT_PATTERNS)
    .filter(([, kws]) => kws.some((kw) => lower.includes(kw)))
    .map(([event]) => event);
}

// ─── Impact scoring ────────────────────────────────────────────────────────────
const HIGH_IMPACT_SOURCES = ['Bloomberg Markets', 'Reuters Business'];
const HIGH_IMPACT_EVENTS   = ['hack_exploit', 'etf', 'regulation', 'market_crash', 'rally'];

function deriveImpact(item, sentiment) {
  let score = 0;

  if (sentiment) {
    score += Math.abs(sentiment.compound) * 40;  // max 40
  }

  const events = detectEvents(item.title + ' ' + item.summary);
  if (events.some((e) => HIGH_IMPACT_EVENTS.includes(e))) score += 35;
  else if (events.length > 0) score += 15;

  if (HIGH_IMPACT_SOURCES.includes(item.source)) score += 15;

  const hoursSincePub = (Date.now() - new Date(item.publishedAt).getTime()) / 3600000;
  if (hoursSincePub < 1) score += 10;
  else if (hoursSincePub < 6) score += 5;

  score = Math.min(Math.round(score), 100);
  const level = score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
  return { score, level };
}

// ─── Keyword extraction ────────────────────────────────────────────────────────
const STOP_WORDS = new Set(['the','a','an','in','on','at','to','for','of','and','or','is','are','was','with','by','as','it','its','be','this','that','from','not','but']);

function extractKeywords(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
    .slice(0, 10);
}

// ─── Query helpers ─────────────────────────────────────────────────────────────
async function getNewsForAsset(asset, hours = 24, limit = 20) {
  const since = new Date(Date.now() - hours * 3600000);
  return NewsData.find({
    relatedAssets: asset,
    publishedAt: { $gte: since },
  })
    .sort({ 'impact.score': -1, publishedAt: -1 })
    .limit(limit);
}

async function getHighImpactNews(hours = 6, limit = 10) {
  const since = new Date(Date.now() - hours * 3600000);
  return NewsData.find({
    publishedAt: { $gte: since },
    'impact.level': { $in: ['high', 'critical'] },
  })
    .sort({ 'impact.score': -1 })
    .limit(limit);
}

module.exports = {
  collectNews,
  getNewsForAsset,
  getHighImpactNews,
  detectRelatedAssets,
  detectEvents,
};
