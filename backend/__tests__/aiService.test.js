/**
 * T-013: backend <-> ai-service integration/contract tests.
 *
 * `backend/src/services/aiService.js` is the primary HTTP client the backend
 * uses to call the ai-service (predictions, news/social sentiment, funding
 * rates, prices, training triggers) -- feeding directly into the AI worker
 * cycle (see aiWorkerService.test.js) and several routes. It had **zero**
 * test coverage before this file, despite every function on this path
 * silently swallowing errors and returning a fallback value (null / {} /
 * 'unreachable') rather than throwing -- a real risk if that fallback
 * behavior ever regressed (e.g. a future edit that lets an error propagate
 * and crashes a cron job, or one that swallows a *successful* response by
 * mistake).
 *
 * Scope: every exported function is tested for (a) the exact HTTP method +
 * path + body it sends -- this is the actual contract with ai-service's
 * FastAPI routes (`ai-service/app/api/routes.py`, mounted under `/api`) --
 * and (b) that a network failure degrades to the documented fallback
 * instead of throwing. Cross-checked against the live ai-service route
 * table on 2026-08-18: /api/predict, /api/news/analyze, /api/social/analyze,
 * /api/status, /api/train, /api/macro/funding-rates, /api/prices/{asset}
 * all currently exist server-side -- no drift found (see PROJECT_STATUS.md
 * T-013 entry). This suite is what will catch it if that ever changes.
 *
 * `axios.create()` returns a new instance at module-load time, so directly
 * monkeypatching `axios.post`/`axios.get` (as aiWorkerService.test.js does
 * for the plain `axios` module) would NOT intercept calls made through that
 * instance. Instead we mock the whole `axios` module so `axios.create()`
 * returns one shared fake instance we control.
 */
jest.mock('axios', () => {
  const mockInstance = { get: jest.fn(), post: jest.fn() };
  return {
    create: jest.fn(() => mockInstance),
    __mockInstance: mockInstance,
  };
});

const axios = require('axios');
const mockInstance = axios.__mockInstance;

const {
  generatePrediction,
  analyzeNews,
  analyzeSocial,
  getModelStatus,
  trainModel,
  getFundingRates,
  getPrice,
} = require('../src/services/aiService');

beforeEach(() => {
  mockInstance.get.mockReset();
  mockInstance.post.mockReset();
});

describe('generatePrediction', () => {
  test('posts /api/predict with the asset and returns the response body', async () => {
    mockInstance.post.mockResolvedValue({ data: { asset: 'BTCUSDT', prediction: 'up', confidence: 0.7 } });
    const result = await generatePrediction('BTCUSDT');
    expect(mockInstance.post).toHaveBeenCalledWith('/api/predict', { asset: 'BTCUSDT' });
    expect(result).toEqual({ asset: 'BTCUSDT', prediction: 'up', confidence: 0.7 });
  });

  test('returns null (not a throw) when ai-service is unreachable', async () => {
    mockInstance.post.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(generatePrediction('BTCUSDT')).resolves.toBeNull();
  });
});

describe('analyzeNews', () => {
  test('posts /api/news/analyze with the headlines array', async () => {
    mockInstance.post.mockResolvedValue({ data: { sentiment: 'bullish' } });
    const headlines = ['ETF approved', 'Rate cut expected'];
    const result = await analyzeNews(headlines);
    expect(mockInstance.post).toHaveBeenCalledWith('/api/news/analyze', { headlines });
    expect(result).toEqual({ sentiment: 'bullish' });
  });

  test('returns null on failure', async () => {
    mockInstance.post.mockRejectedValue(new Error('timeout of 30000ms exceeded'));
    await expect(analyzeNews(['x'])).resolves.toBeNull();
  });
});

describe('analyzeSocial', () => {
  test('posts /api/social/analyze with the posts array', async () => {
    mockInstance.post.mockResolvedValue({ data: { sentiment: 'neutral' } });
    const posts = [{ text: 'BTC to the moon' }];
    const result = await analyzeSocial(posts);
    expect(mockInstance.post).toHaveBeenCalledWith('/api/social/analyze', { posts });
    expect(result).toEqual({ sentiment: 'neutral' });
  });

  test('returns null on failure', async () => {
    mockInstance.post.mockRejectedValue(new Error('502'));
    await expect(analyzeSocial([])).resolves.toBeNull();
  });
});

describe('getModelStatus', () => {
  test('gets /api/status and returns the response body', async () => {
    mockInstance.get.mockResolvedValue({ data: { status: 'ready', models_loaded: 6 } });
    const result = await getModelStatus();
    expect(mockInstance.get).toHaveBeenCalledWith('/api/status');
    expect(result).toEqual({ status: 'ready', models_loaded: 6 });
  });

  test('falls back to a synthetic { status: "unreachable" } on failure (not null, unlike the other functions)', async () => {
    mockInstance.get.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(getModelStatus()).resolves.toEqual({ status: 'unreachable' });
  });
});

describe('trainModel', () => {
  test('posts /api/train with the asset and interval', async () => {
    mockInstance.post.mockResolvedValue({ data: { started: true } });
    const result = await trainModel('ETHUSDT', '4h');
    expect(mockInstance.post).toHaveBeenCalledWith('/api/train', { asset: 'ETHUSDT', interval: '4h' });
    expect(result).toEqual({ started: true });
  });

  test('defaults interval to "1h" when not provided', async () => {
    mockInstance.post.mockResolvedValue({ data: { started: true } });
    await trainModel('BTCUSDT');
    expect(mockInstance.post).toHaveBeenCalledWith('/api/train', { asset: 'BTCUSDT', interval: '1h' });
  });

  test('returns null on failure', async () => {
    mockInstance.post.mockRejectedValue(new Error('model busy'));
    await expect(trainModel('BTCUSDT')).resolves.toBeNull();
  });
});

describe('getFundingRates', () => {
  test('gets /api/macro/funding-rates and returns response.data.rates', async () => {
    mockInstance.get.mockResolvedValue({ data: { rates: { BTCUSDT: 0.0001 } } });
    const result = await getFundingRates();
    expect(mockInstance.get).toHaveBeenCalledWith('/api/macro/funding-rates');
    expect(result).toEqual({ BTCUSDT: 0.0001 });
  });

  test('defaults to {} when the response has no rates field', async () => {
    mockInstance.get.mockResolvedValue({ data: {} });
    await expect(getFundingRates()).resolves.toEqual({});
  });

  test('defaults to {} on failure', async () => {
    mockInstance.get.mockRejectedValue(new Error('down'));
    await expect(getFundingRates()).resolves.toEqual({});
  });
});

describe('getPrice', () => {
  test('gets /api/prices/{asset} and returns response.data.price', async () => {
    mockInstance.get.mockResolvedValue({ data: { price: 65000.5 } });
    const result = await getPrice('BTCUSDT');
    expect(mockInstance.get).toHaveBeenCalledWith('/api/prices/BTCUSDT');
    expect(result).toBe(65000.5);
  });

  test('a legitimate price of exactly 0 is returned as 0, not coerced to null (regression guard for ?? vs ||)', async () => {
    mockInstance.get.mockResolvedValue({ data: { price: 0 } });
    await expect(getPrice('SOMESTABLE')).resolves.toBe(0);
  });

  test('returns null when the response has no price field', async () => {
    mockInstance.get.mockResolvedValue({ data: {} });
    await expect(getPrice('BTCUSDT')).resolves.toBeNull();
  });

  test('returns null on failure', async () => {
    mockInstance.get.mockRejectedValue(new Error('not found'));
    await expect(getPrice('BTCUSDT')).resolves.toBeNull();
  });
});
