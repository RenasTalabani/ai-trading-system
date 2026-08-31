const MarketData = require('../models/MarketData');
const axios = require('axios');
const logger = require('../config/logger');
const {
  fetchCurrentPrice,
  fetch24hTicker,
  fetchBatchTickers,
  getAllCachedPrices,
  getLastKnownPrice,
  getLastKnownTickers,
  TRACKED_ASSETS,
} = require('../services/binanceService');
const aiService = require('../services/aiService');

exports.getSupportedAssets = (req, res) => {
  res.status(200).json({ success: true, assets: TRACKED_ASSETS });
};

// T-084 (2026-08-31): all three live-fetch endpoints below now fall back to
// the last-known price/ticker stored in MarketData when the live Binance
// call fails (excluding a genuine "unknown symbol" 400, which stays a 404 --
// no amount of fallback data makes up a real asset). Falling back is only
// attempted for actual fetch failures, and every fallback response is
// explicitly marked `stale: true` with the real `asOf` timestamp of the
// data it's serving -- never presented as live. See binanceService.js's
// T-084 comment for why this exists (the live outage's real root cause).
exports.getLivePrices = async (req, res) => {
  const prices = getAllCachedPrices();
  if (Object.keys(prices).length > 0) {
    return res.status(200).json({
      success: true,
      count: Object.keys(prices).length,
      prices,
      stale: false,
      timestamp: new Date().toISOString(),
    });
  }

  // Live cache empty (WS stream down and REST poll failing) -- fall back to
  // the most recent stored candle per tracked asset rather than returning
  // an empty set.
  const rows = await getLastKnownTickers(TRACKED_ASSETS).catch(() => []);
  const fallbackPrices = Object.fromEntries(
    rows.map((r) => [r.asset, { price: r.price, ts: new Date(r.timestamp).getTime() }])
  );
  res.status(200).json({
    success: true,
    count: Object.keys(fallbackPrices).length,
    prices: fallbackPrices,
    stale: Object.keys(fallbackPrices).length > 0,
    timestamp: new Date().toISOString(),
  });
};

exports.getAssetPrice = async (req, res, next) => {
  const asset = req.params.asset.toUpperCase();
  try {
    const price = await fetchCurrentPrice(asset);
    res.status(200).json({
      success: true,
      asset,
      price,
      stale: false,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    if (err.response?.status === 400) {
      return res.status(404).json({ success: false, message: `Asset ${req.params.asset} not found.` });
    }
    logger.error('Price fetch error:', err.message);
    const fallback = await getLastKnownPrice(asset).catch(() => null);
    if (fallback) {
      return res.status(200).json({
        success: true,
        asset,
        price: fallback.price,
        stale: true,
        asOf: fallback.timestamp,
        timestamp: new Date().toISOString(),
      });
    }
    next(err);
  }
};

exports.getAssetTicker = async (req, res, next) => {
  const asset = req.params.asset.toUpperCase();
  try {
    const ticker = await fetch24hTicker(asset);
    res.status(200).json({ success: true, ...ticker, stale: false });
  } catch (err) {
    if (err.response?.status === 400) {
      return res.status(404).json({ success: false, message: `Asset ${req.params.asset} not found.` });
    }
    logger.error('Ticker fetch error:', err.message);
    const fallback = await getLastKnownPrice(asset).catch(() => null);
    if (fallback) {
      // 24h change/high/low aren't in MarketData -- only price is known,
      // so those fields come back null rather than a fabricated 0.
      return res.status(200).json({
        success: true, asset,
        price: fallback.price, change24h: null, changePercent: null,
        high24h: null, low24h: null, volume24h: null, quoteVolume24h: null,
        stale: true, asOf: fallback.timestamp,
      });
    }
    next(err);
  }
};

exports.getBatchTickers = async (req, res, next) => {
  try {
    const raw = req.body.assets || req.query.assets;
    const assets = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(',') : []);
    if (!assets.length) return res.status(400).json({ success: false, message: 'assets required' });

    // Binance's batch endpoint rejects the whole request if any symbol isn't
    // a Binance pair (e.g. XAUUSD) — only forward the ones it actually knows.
    const binanceAssets = assets.filter((a) => TRACKED_ASSETS.includes(a.toUpperCase()));
    if (!binanceAssets.length) return res.status(200).json({ success: true, tickers: [], stale: false });

    try {
      const tickers = await fetchBatchTickers(binanceAssets);
      return res.status(200).json({ success: true, tickers, stale: false });
    } catch (err) {
      logger.error('Batch ticker error:', err.message);
      const rows = await getLastKnownTickers(binanceAssets).catch(() => []);
      const tickers = rows.map((r) => ({
        asset: r.asset, price: r.price, change24h: null, changePercent: null,
        high24h: null, low24h: null, volume24h: null, quoteVolume24h: null,
        stale: true, asOf: r.timestamp,
      }));
      return res.status(200).json({ success: true, tickers, stale: tickers.length > 0 });
    }
  } catch (err) {
    logger.error('Batch ticker error:', err.message);
    next(err);
  }
};

exports.getMarketData = async (req, res, next) => {
  try {
    const asset = req.params.asset.toUpperCase();
    const { interval = '1h', limit = 100 } = req.query;

    const data = await MarketData.find({ asset, interval })
      .sort({ timestamp: -1 })
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      asset,
      interval,
      count: data.length,
      data,
    });
  } catch (err) {
    next(err);
  }
};

exports.trainModel = async (req, res, next) => {
  try {
    const { asset = 'BTCUSDT', interval = '1h' } = req.body;
    logger.info(`Model training triggered by admin for ${asset}`);

    const result = await aiService.trainModel(asset, interval);
    if (!result) {
      return res.status(502).json({ success: false, message: 'AI service training failed.' });
    }

    res.status(200).json({ success: true, message: 'Model training started.', result });
  } catch (err) {
    next(err);
  }
};
