// Telegram webhook secret verification tests (TASKS.md T-020).
//
// Two layers, same pattern as cors.test.js: fast unit tests against the
// middleware function directly, plus an HTTP integration test mounting only
// this middleware + a probe route (not the full app / not the real
// telegramController, which needs no DB for these purposes).

const express = require('express');
const request = require('supertest');
const { verifyTelegramWebhook } = require('../src/middleware/telegramWebhookAuth');

const REAL_SECRET = 'a-strong-random-secret-value-1234567890';
const ORIGINAL_SECRET_ENV = process.env.TELEGRAM_WEBHOOK_SECRET;

afterEach(() => {
  if (ORIGINAL_SECRET_ENV === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
  else process.env.TELEGRAM_WEBHOOK_SECRET = ORIGINAL_SECRET_ENV;
});

function mockReqRes(headerValue) {
  const req = { headers: {} };
  if (headerValue !== undefined) req.headers['x-telegram-bot-api-secret-token'] = headerValue;
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return { req, res };
}

describe('verifyTelegramWebhook (unit)', () => {
  test('correct secret -> calls next(), no response sent', () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = REAL_SECRET;
    const { req, res } = mockReqRes(REAL_SECRET);
    const next = jest.fn();
    verifyTelegramWebhook(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });

  test('missing secret header -> rejected with 403, next() not called', () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = REAL_SECRET;
    const { req, res } = mockReqRes(undefined);
    const next = jest.fn();
    verifyTelegramWebhook(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test('incorrect secret -> rejected with 403, next() not called', () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = REAL_SECRET;
    const { req, res } = mockReqRes('totally-wrong-secret');
    const next = jest.fn();
    verifyTelegramWebhook(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test('server has no secret configured -> fails closed, rejected even with a header present', () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const { req, res } = mockReqRes('anything-at-all');
    const next = jest.fn();
    verifyTelegramWebhook(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test('malformed header (empty string) -> rejected with 403', () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = REAL_SECRET;
    const { req, res } = mockReqRes('');
    const next = jest.fn();
    verifyTelegramWebhook(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  test('does not leak the configured secret in the rejection response', () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = REAL_SECRET;
    const { req, res } = mockReqRes('wrong');
    verifyTelegramWebhook(req, res, jest.fn());
    expect(JSON.stringify(res.body)).not.toContain(REAL_SECRET);
  });
});

describe('verifyTelegramWebhook wired into a real HTTP request (integration)', () => {
  function makeApp() {
    const app = express();
    app.use(express.json());
    app.post('/telegram/webhook', verifyTelegramWebhook, (req, res) => {
      res.json({ success: true, reachedHandler: true });
    });
    return app;
  }

  test('correct secret -> 200, request reaches the handler', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = REAL_SECRET;
    const app = makeApp();
    const res = await request(app)
      .post('/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', REAL_SECRET)
      .send({ message: { chat: { id: 123 }, text: '/start' } });
    expect(res.status).toBe(200);
    expect(res.body.reachedHandler).toBe(true);
  });

  test('missing secret header -> 403, handler never reached', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = REAL_SECRET;
    const app = makeApp();
    const res = await request(app)
      .post('/telegram/webhook')
      .send({ message: { chat: { id: 123 }, text: '/start' } });
    expect(res.status).toBe(403);
    expect(res.body.reachedHandler).toBeUndefined();
  });

  test('incorrect secret -> 403, handler never reached', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = REAL_SECRET;
    const app = makeApp();
    const res = await request(app)
      .post('/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', 'not-the-real-secret')
      .send({ message: { chat: { id: 123 }, text: '/start' } });
    expect(res.status).toBe(403);
    expect(res.body.reachedHandler).toBeUndefined();
  });

  test('a well-formed, Telegram-shaped payload without the secret is still rejected before processing', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = REAL_SECRET;
    const app = makeApp();
    const res = await request(app)
      .post('/telegram/webhook')
      .send({
        update_id: 123456,
        message: {
          message_id: 1,
          chat: { id: 987654321, type: 'private' },
          text: '/start SOME_VALID_LOOKING_TOKEN',
          date: 1700000000,
        },
      });
    expect(res.status).toBe(403);
    expect(res.body.reachedHandler).toBeUndefined();
  });
});
