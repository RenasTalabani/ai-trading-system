const dns = require('dns');
const mongoose = require('mongoose');
const logger = require('./logger');

// Use Google DNS to bypass corporate DNS blocks on MongoDB Atlas SRV records
dns.setServers(['8.8.8.8', '8.8.4.4']);

let isConnected = false;

async function connectDB() {
  if (isConnected) return;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not defined in environment variables.');

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    isConnected = true;
    logger.info('MongoDB Atlas connected successfully.');

    mongoose.connection.on('disconnected', () => {
      isConnected = false;
      logger.warn('MongoDB disconnected. Attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      isConnected = true;
      logger.info('MongoDB reconnected.');
    });

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
    });
  } catch (err) {
    logger.error('MongoDB connection failed:', err.message);
    logger.warn('Server will start without DB — retrying connection in 30s...');
    // Retry in 30 s instead of crashing — lets the app serve cached/static routes
    setTimeout(() => {
      isConnected = false;
      connectDB().catch(() => {});
    }, 30_000);
  }
}

async function disconnectDB() {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
  logger.info('MongoDB disconnected.');
}

module.exports = { connectDB, disconnectDB };
