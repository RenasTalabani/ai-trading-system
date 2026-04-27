const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const router = express.Router();

router.get('/', async (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };

  let aiServiceStatus = 'unreachable';
  try {
    const aiRes = await axios.get(`${process.env.AI_SERVICE_URL}/api/health`, { timeout: 3000 });
    if (aiRes.status === 200) aiServiceStatus = 'connected';
  } catch (_) {}

  res.status(200).json({
    success: true,
    status: 'operational',
    timestamp: new Date().toISOString(),
    services: {
      backend: 'online',
      database: dbStatus[dbState] || 'unknown',
      aiService: aiServiceStatus,
    },
    version: process.env.API_VERSION || 'v1',
    environment: process.env.NODE_ENV,
  });
});

module.exports = router;
