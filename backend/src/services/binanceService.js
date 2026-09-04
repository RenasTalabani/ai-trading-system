const axios = require('axios');
const WebSocket = require('ws');
const MarketData = require('../models/MarketData');
const logger = require('../config/logger');

const BINANCE_REST = process.env.BINANCE_BASE_URL || 'https://api.binance.com';
const _wsBase = (process.env.BINANCE_BASE_URL || '').includes('binance.us')
  ? 'wss://stream.binance.us:9443/stream'
  : 'wss://stream.binance.com:9443/stream';
const BINANCE_WS = process.env.BINANCE_WS_URL || _wsBase;

const TRACKED_ASSETS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  // Decision #18 (locked, 2026-09-03): gold = PAXG, a real Binance spot
  // pair (Paxos Gold, backed 1:1 by physical gold) -- tracked through the
  // exact same live WS/REST pipeline as every other crypto asset here,
  // never through a separate XAUUSD forex feed. Mirrors ai-service's own
  // binance_collector.py TRACKED_ASSETS (same position, for consistency).
  'ADAUSDT', 'PAXGUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'MATICUSDT',
];

const INTERVAL_MAP = {
  '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440,
};

// In-memory price cache
const priceCache = new Map();

// ─── REST: Fetch historical candles ──────────────────────────────────────────

async function fetchKlines(asset, interval = '1h', limit = 500) {
  const resp = await axios.get(`${BINANCE_REST}/api/v3/klines`, {
    params: { symbol: asset, interval, limit },
    timeout: 10000,
  });

  return resp.data.map((k) => ({
    asset,
    exchange: 'binance',
    interval,
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    timestamp: new Date(k[0]),
  }));
}

async function fetchCurrentPrice(asset) {
  const resp = await axios.get(`${BINANCE_REST}/api/v3/ticker/price`, {
    params: { symbol: asset },
    timeout: 5000,
  });
  return parseFloat(resp.data.price);
}

async function fetch24hTicker(asset) {
  const resp = await axios.get(`${BINANCE_REST}/api/v3/ticker/24hr`, {
    params: { symbol: asset.toUpperCase() },
    timeout: 5000,
  });
  const d = resp.data;
  return {
    asset:          d.symbol,
    price:          parseFloat(d.lastPrice),
    change24h:      parseFloat(d.priceChange),
    changePercent:  parseFloat(d.priceChangePercent),
    high24h:        parseFloat(d.highPrice),
    low24h:         parseFloat(d.lowPrice),
    volume24h:      parseFloat(d.volume),
    quoteVolume24h: parseFloat(d.quoteVolume),
  };
}

async function fetchBatchTickers(assets) {
  const symbols = JSON.stringify(assets.map((a) => a.toUpperCase()));
  const resp = await axios.get(`${BINANCE_REST}/api/v3/ticker/24hr`, {
    params: { symbols },
    timeout: 8000,
  });
  return resp.data.map((d) => ({
    asset:          d.symbol,
    price:          parseFloat(d.lastPrice),
    change24h:      parseFloat(d.priceChange),
    changePercent:  parseFloat(d.priceChangePercent),
    high24h:        parseFloat(d.highPrice),
    low24h:         parseFloat(d.lowPrice),
    volume24h:      parseFloat(d.volume),
    quoteVolume24h: parseFloat(d.quoteVolume),
  }));
}

// ─── Historical data collector ────────────────────────────────────────────────

async function collectHistoricalData(asset, interval = '1h', limit = 500) {
  try {
    const candles = await fetchKlines(asset, interval, limit);
    const ops = candles.map((c) => ({
      updateOne: {
        filter: { asset: c.asset, interval: c.interval, timestamp: c.timestamp },
        update: { $set: c },
        upsert: true,
      },
    }));
    const result = await MarketData.bulkWrite(ops, { ordered: false });
    logger.info(`[${asset}/${interval}] Stored ${result.upsertedCount} new + ${result.modifiedCount} updated candles`);
    return candles.length;
  } catch (err) {
    logger.error(`Historical data collection failed for ${asset}:`, err.message);
    return 0;
  }
}

async function collectAllAssets(interval = '1h') {
  logger.info(`Starting bulk market data collection for ${TRACKED_ASSETS.length} assets...`);
  const results = await Promise.allSettled(
    TRACKED_ASSETS.map((a) => collectHistoricalData(a, interval))
  );
  const total = results.reduce((sum, r) => sum + (r.status === 'fulfilled' ? r.value : 0), 0);
  logger.info(`Bulk collection complete. Total candles processed: ${total}`);
  return total;
}

// ─── Live WebSocket stream ────────────────────────────────────────────────────

let binanceWs = null;
let reconnectTimer = null;
let priceUpdateCallback = null;

function startLivePriceStream(onPriceUpdate) {
  priceUpdateCallback = onPriceUpdate;

  const streams = TRACKED_ASSETS.map((a) => `${a.toLowerCase()}@miniTicker`).join('/');
  const url = `${BINANCE_WS}?streams=${streams}`;

  const connect = () => {
    if (binanceWs) {
      binanceWs.removeAllListeners();
      binanceWs.terminate();
    }

    binanceWs = new WebSocket(url);

    binanceWs.on('open', () => {
      logger.info(`Binance live stream connected: ${TRACKED_ASSETS.length} assets`);
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    });

    binanceWs.on('message', (raw) => {
      try {
        const { data } = JSON.parse(raw);
        if (!data || !data.s) return;
        const price = parseFloat(data.c);
        priceCache.set(data.s, { price, ts: Date.now() });
        if (priceUpdateCallback) priceUpdateCallback(data.s, price);
      } catch (_) {}
    });

    binanceWs.on('close', (code) => {
      logger.warn(`Binance stream closed (${code}). Reconnecting in 5s...`);
      reconnectTimer = setTimeout(connect, 5000);
    });

    binanceWs.on('error', (err) => {
      logger.error('Binance stream error:', err.message);
    });
  };

  connect();
}

function stopLivePriceStream() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (binanceWs) { binanceWs.terminate(); binanceWs = null; }
  logger.info('Binance live stream stopped.');
}

// REST polling fallback — populates price cache when WebSocket data isn't flowing
let _restPollTimer = null;
async function pollPricesRest() {
  try {
    const resp = await axios.get(`${BINANCE_REST}/api/v3/ticker/price`, { timeout: 8000 });
    const symbols = new Set(TRACKED_ASSETS);
    for (const item of resp.data) {
      if (symbols.has(item.symbol)) {
        priceCache.set(item.symbol, { price: parseFloat(item.price), ts: Date.now() });
      }
    }
    logger.info(`REST price poll: populated ${priceCache.size} prices`);
  } catch (err) {
    logger.warn('REST price poll failed:', err.message);
  }
}

function startRestPricePoll(intervalMs = 30000) {
  pollPricesRest();
  _restPollTimer = setInterval(pollPricesRest, intervalMs);
}

function stopRestPricePoll() {
  if (_restPollTimer) { clearInterval(_restPollTimer); _restPollTimer = null; }
}

function getCachedPrice(asset) {
  return priceCache.get(asset) || null;
}

function getAllCachedPrices() {
  return Object.fromEntries(priceCache);
}

// BUG-003 (2026-08-29 overnight validation): MATICUSDT's position was
// found frozen at exactly its entry price / 0% P&L for 19+ consecutive
// days -- Binance put the symbol under trading status "BREAK" (the
// MATIC->POL migration), so it never appears in priceCache (no WebSocket
// ticks, no REST-poll entry) and the caller previously fell back to
// trade.entryPrice, silently rendering a permanent, indistinguishable-
// from-real "0% P&L, nothing has changed" state instead of "unavailable".
// This checks the symbol's real exchange status directly (the same
// exchangeInfo endpoint used to diagnose the MATICUSDT case) so callers
// can tell "genuinely halted" apart from "price cache just hasn't
// populated yet" instead of guessing from an absent cache entry alone.
// Cached for an hour -- trading-status changes are rare and slow-moving,
// unlike price, so this doesn't need to be checked on every request.
const _symbolStatusCache = new Map(); // asset -> { status, ts }
const SYMBOL_STATUS_TTL_MS = 60 * 60 * 1000;

async function getSymbolStatus(asset) {
  const hit = _symbolStatusCache.get(asset);
  if (hit && (Date.now() - hit.ts) < SYMBOL_STATUS_TTL_MS) {
    return hit.status;
  }
  try {
    const resp = await axios.get(`${BINANCE_REST}/api/v3/exchangeInfo`, {
      params: { symbol: asset },
      timeout: 8000,
    });
    const status = resp.data?.symbols?.[0]?.status || null;
    _symbolStatusCache.set(asset, { status, ts: Date.now() });
    return status;
  } catch (err) {
    logger.warn(`[Binance] getSymbolStatus(${asset}) failed:`, err.message);
    // Unknown, not "halted" -- don't let a transient API error masquerade
    // as a real exchange halt and trigger the halted-close path below.
    return hit ? hit.status : null;
  }
}

// ─── Last-known-price fallback (T-084, 2026-08-31) ───────────────────────────
// Live watchlist prices went blank in production: Binance became fully
// unreachable from this service (WS stream stuck in a permanent 1006-close/
// reconnect loop, REST calls returning 451) while ai-service's identical
// default Binance calls kept succeeding -- almost certainly a Railway
// egress-IP/region difference between the two services, not a code bug (see
// the T-083 commit message for the live evidence trail). That's an
// infrastructure fix outside this codebase's reach (needs the backend
// service's Railway region aligned with ai-service's, a dashboard action).
// In the meantime, marketController's price/ticker endpoints had zero
// fallback -- a live-fetch failure meant an empty/error response and a
// blank watchlist, even though MarketData already holds recent candles from
// before the outage (written by the same collectHistoricalData() job this
// same outage is currently also blocking, so this data ages during a long
// outage -- that's why every fallback response below is explicitly marked
// stale with its real timestamp, never presented as live).
async function getLastKnownPrice(asset) {
  const doc = await MarketData.findOne({ asset, interval: '1h' })
    .sort({ timestamp: -1 })
    .lean();
  return doc ? { asset, price: doc.close, timestamp: doc.timestamp } : null;
}

async function getLastKnownTickers(assets) {
  if (!assets.length) return [];
  const rows = await MarketData.aggregate([
    { $match: { asset: { $in: assets }, interval: '1h' } },
    { $sort: { asset: 1, timestamp: -1 } },
    { $group: { _id: '$asset', close: { $first: '$close' }, timestamp: { $first: '$timestamp' } } },
  ]);
  return rows.map((r) => ({ asset: r._id, price: r.close, timestamp: r.timestamp }));
}

module.exports = {
  fetchKlines,
  getSymbolStatus,
  startRestPricePoll,
  stopRestPricePoll,
  fetchCurrentPrice,
  fetch24hTicker,
  fetchBatchTickers,
  collectHistoricalData,
  collectAllAssets,
  startLivePriceStream,
  stopLivePriceStream,
  getCachedPrice,
  getAllCachedPrices,
  getLastKnownPrice,
  getLastKnownTickers,
  TRACKED_ASSETS,
};
