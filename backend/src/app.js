const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const signalRoutes = require('./routes/signals');
const marketRoutes = require('./routes/market');
const healthRoutes = require('./routes/health');
const userRoutes = require('./routes/users');
const newsRoutes = require('./routes/news');
const socialRoutes = require('./routes/social');
const aiRoutes = require('./routes/ai');
const notificationRoutes = require('./routes/notifications');
const telegramRoutes = require('./routes/telegram');
const virtualRoutes   = require('./routes/virtual');
const strategyRoutes  = require('./routes/strategy');
const pnlRoutes       = require('./routes/pnl');
const orderBlockRoutes = require('./routes/orderBlocks');
const unifiedRoutes    = require('./routes/unified');
const globalRoutes     = require('./routes/global');
const budgetRoutes     = require('./routes/budget');
const aiBrainRoutes    = require('./routes/aiBrain');
const advisorRoutes    = require('./routes/advisor');
const simulatorRoutes  = require('./routes/simulator');
const reportsRoutes    = require('./routes/reports');
const trackerRoutes    = require('./routes/tracker');
const macroRoutes      = require('./routes/macro');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const logger = require('./config/logger');

const app = express();

// Security headers
app.use(helmet());

// CORS — allow all origins in production (Flutter mobile sends no Origin header)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',').filter(Boolean);
const corsAll = allowedOrigins.includes('*');
app.use(cors({
  origin: (origin, cb) => {
    if (corsAll || !origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: !corsAll,
}));

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// HTTP logging
app.use(morgan('combined', {
  stream: { write: (msg) => logger.http(msg.trim()) },
}));

// Global rate limiter
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// Routes
const API = `/api/${process.env.API_VERSION || 'v1'}`;
app.use(`${API}/health`, healthRoutes);
app.use(`${API}/auth`, authRoutes);
app.use(`${API}/users`, userRoutes);
app.use(`${API}/signals`, signalRoutes);
app.use(`${API}/market`, marketRoutes);
app.use(`${API}/news`, newsRoutes);
app.use(`${API}/social`, socialRoutes);
app.use(`${API}/ai`, aiRoutes);
app.use(`${API}/notifications`, notificationRoutes);
app.use(`${API}/telegram`,      telegramRoutes);
app.use(`${API}/virtual`,       virtualRoutes);
app.use(`${API}/strategy`,      strategyRoutes);
app.use(`${API}/pnl`,           pnlRoutes);
app.use(`${API}/order-blocks`,  orderBlockRoutes);
app.use(`${API}/unified`,       unifiedRoutes);
app.use(`${API}/global`,        globalRoutes);
app.use(`${API}/budget`,        budgetRoutes);
app.use(`${API}/ai-brain`,      aiBrainRoutes);
app.use(`${API}/advisor`,       advisorRoutes);
app.use(`${API}/simulator`,     simulatorRoutes);
app.use(`${API}/reports`,       reportsRoutes);
app.use(`${API}/tracker`,       trackerRoutes);
app.use(`${API}/macro`,         macroRoutes);

// 404 + error handler
app.use(notFound);
app.use(errorHandler);

module.exports = app;
