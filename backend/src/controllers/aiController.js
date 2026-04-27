const axios = require('axios');
const BacktestResult = require('../models/BacktestResult');
const logger = require('../config/logger');

const AI = () => process.env.AI_SERVICE_URL || 'http://localhost:8000';

exports.getAIStatus = async (req, res, next) => {
  try {
    const resp = await axios.get(`${AI()}/api/status`, { timeout: 10000 });
    res.status(200).json({ success: true, ...resp.data });
  } catch (err) {
    logger.error('AI status fetch failed:', err.message);
    res.status(503).json({ success: false, message: 'AI service unreachable.', error: err.message });
  }
};

exports.getModelHealth = async (req, res, next) => {
  try {
    const resp = await axios.get(`${AI()}/api/health`, { timeout: 5000 });
    res.status(200).json({ success: true, ...resp.data });
  } catch (err) {
    res.status(503).json({ success: false, message: 'AI service health check failed.' });
  }
};

exports.runBacktest = async (req, res, next) => {
  try {
    const { asset = 'BTCUSDT', interval = '1h', min_confidence = 65 } = req.body;
    logger.info(`Backtest requested by ${req.user.role}: ${asset}/${interval}`);

    const resp = await axios.post(`${AI()}/api/backtest`, {
      asset, interval, min_confidence, max_candles: 1000,
    }, { timeout: 120000 });

    const data = resp.data;

    // Persist result
    await BacktestResult.create({
      asset:          data.asset,
      interval:       data.interval,
      periodStart:    data.period_start,
      periodEnd:      data.period_end,
      totalTrades:    data.total_trades,
      wins:           data.wins,
      losses:         data.losses,
      winRate:        data.win_rate,
      totalReturnPct: data.total_return_pct,
      profitFactor:   data.profit_factor,
      maxDrawdownPct: data.max_drawdown_pct,
      sharpeRatio:    data.sharpe_ratio,
      avgWinPct:      data.avg_win_pct,
      avgLossPct:     data.avg_loss_pct,
      totalPnlUsd:    data.total_pnl_usd,
      triggeredBy:    req.user.role,
    });

    res.status(200).json({ success: true, result: data });
  } catch (err) {
    logger.error('Backtest failed:', err.message);
    next(err);
  }
};

exports.getFeedbackStats = async (req, res, next) => {
  try {
    const resp = await axios.get(`${AI()}/api/feedback/stats`, { timeout: 10000 });
    res.status(200).json({ success: true, ...resp.data });
  } catch (err) {
    res.status(503).json({ success: false, message: 'Feedback stats unavailable.' });
  }
};

exports.triggerEvaluation = async (req, res, next) => {
  try {
    await axios.post(`${AI()}/api/feedback/evaluate`, {}, { timeout: 10000 });
    res.status(202).json({ success: true, message: 'Feedback evaluation triggered.' });
  } catch (err) {
    next(err);
  }
};
