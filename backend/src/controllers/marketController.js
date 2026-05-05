const MarketData = require('../models/MarketData');
const axios = require('axios');
const logger = require('../config/logger');
const {
  fetchCurrentPrice,
  fetch24hTicker,
  fetchBatchTickers,
  getAllCachedPrices,
  TRACKED_ASSETS,
} = require('../services/binanceService');
const aiService = require('../services/aiService');

exports.getSupportedAssets = (req, res) => {
  res.status(200).json({ success: true, assets: TRACKED_ASSETS });
};

exports.getLivePrices = (req, res) => {
  const prices = getAllCachedPrices();
  res.status(200).json({
    success: true,
    count: Object.keys(prices).length,
    prices,
    timestamp: new Date().toISOString(),
  });
};

exports.getAssetPrice = async (req, res, next) => {
  try {
    const asset = req.params.asset.toUpperCase();
    const price = await fetchCurrentPrice(asset);
    res.status(200).json({
      success: true,
      asset,
      price,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    if (err.response?.status === 400) {
      return res.status(404).json({ success: false, message: `Asset ${req.params.asset} not found.` });
    }
    logger.error('Price fetch error:', err.message);
    next(err);
  }
};

exports.getAssetTicker = async (req, res, next) => {
  try {
    const asset = req.params.asset.toUpperCase();
    const ticker = await fetch24hTicker(asset);
    res.status(200).json({ success: true, ...ticker });
  } catch (err) {
    if (err.response?.status === 400) {
      return res.status(404).json({ success: false, message: `Asset ${req.params.asset} not found.` });
    }
    logger.error('Ticker fetch error:', err.message);
    next(err);
  }
};

exports.getBatchTickers = async (req, res, next) => {
  try {
    const raw = req.body.assets || req.query.assets;
    const assets = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(',') : []);
    if (!assets.length) return res.status(400).json({ success: false, message: 'assets required' });
    const tickers = await fetchBatchTickers(assets);
    res.status(200).json({ success: true, tickers });
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
