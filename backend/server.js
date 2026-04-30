require('dotenv').config();
const http = require('http');
const app = require('./src/app');
const { connectDB } = require('./src/config/db');
const { initWebSocket } = require('./src/websocket/wsServer');
const { broadcastPriceUpdate } = require('./src/websocket/wsServer');
const { startLivePriceStream, stopLivePriceStream, startRestPricePoll, stopRestPricePoll, getAllCachedPrices } = require('./src/services/binanceService');
const { startMarketDataJob } = require('./src/jobs/marketDataJob');
const { startSignalJob } = require('./src/jobs/signalJob');
const { startNewsJob } = require('./src/jobs/newsJob');
const { startSocialJob } = require('./src/jobs/socialJob');
const { startNotificationRetryJob } = require('./src/jobs/notificationRetryJob');
const { startVirtualTrackingJob }   = require('./src/jobs/virtualTrackingJob');
const { startDailyReportJob }        = require('./src/jobs/dailyReportJob');
const { startWeeklyReportJob }       = require('./src/jobs/weeklyReportJob');
const { start: startGlobalScanJob }  = require('./src/jobs/globalScanJob');
const { startAIWorkerJob }           = require('./src/jobs/aiWorkerJob');
const logger = require('./src/config/logger');

const PORT = process.env.PORT || 5000;

async function bootstrap() {
  await connectDB();

  const server = http.createServer(app);
  initWebSocket(server);

  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT} [${process.env.NODE_ENV}]`);
    logger.info(`AI Service URL: ${process.env.AI_SERVICE_URL}`);
  });

  // Phase 2: Start market data collection + live price stream
  startMarketDataJob();
  startLivePriceStream((asset, price) => {
    broadcastPriceUpdate(asset, price);
  });

  // Fallback: if WebSocket stream is geo-blocked, poll via REST every 30s
  setTimeout(() => {
    if (Object.keys(getAllCachedPrices()).length === 0) {
      logger.warn('WebSocket price cache empty after 30s — starting REST price polling fallback');
      startRestPricePoll(30000);
    }
  }, 30000);

  // Phase 2: Start auto signal generation
  startSignalJob();

  // Phase 3: Start news intelligence collection
  startNewsJob();

  // Phase 4: Start social intelligence monitoring
  startSocialJob();

  // Phase 6: Start notification retry job
  startNotificationRetryJob();

  // Virtual Performance Tracker (isolated sidecar — read-only on signals)
  startVirtualTrackingJob();

  // Performance reports: daily at 08:00 UTC, weekly on Mondays
  startDailyReportJob();
  startWeeklyReportJob();

  // Global AI Brain: scan all asset classes every 30 min, cache result
  startGlobalScanJob();

  // AI Brain Worker: autonomous trade decisions every 5 min
  startAIWorkerJob();

  process.on('unhandledRejection', (err) => {
    logger.error('Unhandled Rejection:', err.message);
    server.close(() => process.exit(1));
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Shutting down gracefully...');
    stopLivePriceStream();
    server.close(() => {
      logger.info('Process terminated.');
      process.exit(0);
    });
  });
}

bootstrap();
