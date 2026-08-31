const axios = require('axios');
const logger = require('../config/logger');

const AI_URL = () => process.env.AI_SERVICE_URL || 'http://localhost:8000';

const aiClient = axios.create({
  baseURL: AI_URL(),
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// T-088 (2026-09-01): /api/predict is signal_engine.py's real fusion
// pipeline (RF + Transformer + News + Social + regime/MTF/funding
// adjustments) -- meaningfully slower than every other AI-service call
// this client makes. Confirmed live in production: "AI prediction failed"
// firing rhythmically every ~30s, one asset after another, in signalJob's
// sequential per-asset loop -- exactly the shared client's 30s default
// timeout cutting the call off, not a real ai-service failure (AISERVICE
// -001 the same night already bounded/parallelized the slow parts on the
// ai-service side, but that fix couldn't help a call that was being
// killed from the Node side first). Given a real cold-cache /predict call
// was independently measured at ~78s end-to-end before that fix, 30s was
// never going to be enough. Overridden per-call here rather than raising
// the shared client's default, since every OTHER call through this client
// (prices, funding rates, status) is genuinely fast and should keep
// failing quickly on a real hang instead of waiting up to a minute.
const PREDICT_TIMEOUT_MS = 90_000;

async function generatePrediction(asset) {
  try {
    const response = await aiClient.post('/api/predict', { asset }, { timeout: PREDICT_TIMEOUT_MS });
    return response.data;
  } catch (err) {
    logger.error(`AI prediction failed for ${asset}:`, err.message);
    return null;
  }
}

async function analyzeNews(headlines) {
  try {
    const response = await aiClient.post('/api/news/analyze', { headlines });
    return response.data;
  } catch (err) {
    logger.error('AI news analysis failed:', err.message);
    return null;
  }
}

async function analyzeSocial(posts) {
  try {
    const response = await aiClient.post('/api/social/analyze', { posts });
    return response.data;
  } catch (err) {
    logger.error('AI social analysis failed:', err.message);
    return null;
  }
}

async function getModelStatus() {
  try {
    const response = await aiClient.get('/api/status');
    return response.data;
  } catch (err) {
    logger.error('AI status check failed:', err.message);
    return { status: 'unreachable' };
  }
}

async function trainModel(asset, interval = '1h') {
  try {
    const response = await aiClient.post('/api/train', { asset, interval });
    return response.data;
  } catch (err) {
    logger.error(`AI model training failed for ${asset}:`, err.message);
    return null;
  }
}

async function getFundingRates() {
  try {
    const response = await aiClient.get('/api/macro/funding-rates');
    return response.data.rates || {};
  } catch (err) {
    logger.error('AI funding rates fetch failed:', err.message);
    return {};
  }
}

async function getPrice(asset) {
  try {
    const response = await aiClient.get(`/api/prices/${asset}`);
    return response.data.price ?? null;
  } catch (err) {
    logger.error(`AI price fetch failed for ${asset}:`, err.message);
    return null;
  }
}

module.exports = {
  generatePrediction, analyzeNews, analyzeSocial, getModelStatus, trainModel,
  getFundingRates, getPrice,
};
