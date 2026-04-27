const axios = require('axios');
const logger = require('../config/logger');

const AI_URL = () => process.env.AI_SERVICE_URL || 'http://localhost:8000';

const aiClient = axios.create({
  baseURL: AI_URL(),
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

async function generatePrediction(asset) {
  try {
    const response = await aiClient.post('/api/predict', { asset });
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

module.exports = { generatePrediction, analyzeNews, analyzeSocial, getModelStatus, trainModel };
