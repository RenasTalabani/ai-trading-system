const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const logger = require('../config/logger');

let wss = null;

function initWebSocket(server) {
  wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.replace('/ws?', ''));
    const token = params.get('token');

    if (!token) {
      ws.close(4001, 'Authentication required');
      return;
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      ws.userId = decoded.id;
      ws.isAlive = true;
      logger.info(`WebSocket connected: user ${decoded.id}`);
    } catch {
      ws.close(4003, 'Invalid token');
      return;
    }

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'subscribe') {
          ws.subscriptions = msg.assets || [];
          ws.send(JSON.stringify({ type: 'subscribed', assets: ws.subscriptions }));
        }
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        }
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    ws.on('close', () => logger.info(`WebSocket disconnected: user ${ws.userId}`));
    ws.on('error', (err) => logger.error(`WebSocket error (${ws.userId}):`, err.message));

    ws.send(JSON.stringify({ type: 'connected', message: 'AI Trading System WebSocket ready.' }));
  });

  // Heartbeat — drop dead connections every 30s
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(heartbeat));
  logger.info('WebSocket server initialized at /ws');
}

function broadcastSignal(signal) {
  if (!wss) return;
  const payload = JSON.stringify({ type: 'signal', data: signal });
  wss.clients.forEach((ws) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const subs = ws.subscriptions || [];
    if (subs.length === 0 || subs.includes(signal.asset)) {
      ws.send(payload);
    }
  });
  logger.info(`Signal broadcast: ${signal.asset} ${signal.direction} → ${wss.clients.size} clients`);
}

function broadcastPriceUpdate(asset, price) {
  if (!wss) return;
  const payload = JSON.stringify({ type: 'price', asset, price, ts: Date.now() });
  wss.clients.forEach((ws) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const subs = ws.subscriptions || [];
    if (subs.includes(asset)) ws.send(payload);
  });
}

function getConnectedClients() {
  return wss ? wss.clients.size : 0;
}

module.exports = { initWebSocket, broadcastSignal, broadcastPriceUpdate, getConnectedClients };
