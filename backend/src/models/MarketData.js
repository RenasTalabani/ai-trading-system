const mongoose = require('mongoose');

const marketDataSchema = new mongoose.Schema(
  {
    asset: { type: String, required: true, uppercase: true },
    exchange: { type: String, default: 'binance' },
    interval: { type: String, enum: ['1m', '5m', '15m', '1h', '4h', '1d'], default: '1h' },
    open: { type: Number, required: true },
    high: { type: Number, required: true },
    low: { type: Number, required: true },
    close: { type: Number, required: true },
    volume: { type: Number, required: true },
    timestamp: { type: Date, required: true },
    indicators: {
      rsi: { type: Number },
      macd: {
        macd: { type: Number },
        signal: { type: Number },
        histogram: { type: Number },
      },
      ema20: { type: Number },
      ema50: { type: Number },
      ema200: { type: Number },
    },
  },
  { timestamps: true }
);

marketDataSchema.index({ asset: 1, interval: 1, timestamp: -1 });

module.exports = mongoose.model('MarketData', marketDataSchema);
