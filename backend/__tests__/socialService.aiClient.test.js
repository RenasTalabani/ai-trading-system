/**
 * T-013: backend <-> ai-service integration/contract tests (social sentiment
 * leg). `socialService.js`'s two ai-service-calling functions had zero test
 * coverage. Unlike aiService.js, this module calls the plain `axios` module
 * directly (not a created instance), so the same monkeypatch pattern
 * aiWorkerService.test.js already uses applies here too.
 *
 * Only the two ai-service HTTP calls are in scope here -- storeSocialPosts
 * and getSocialSentimentForAsset are DB-only (Mongoose), a different
 * concern from this task (backend<->ai-service contract), not covered.
 */
const axios = require('axios');
const { fetchSocialAnalysis, fetchSocialAlerts } = require('../src/services/socialService');

const ORIGINAL_AI_SERVICE_URL = process.env.AI_SERVICE_URL;

beforeEach(() => {
  process.env.AI_SERVICE_URL = 'http://ai-service.test';
});

afterAll(() => {
  process.env.AI_SERVICE_URL = ORIGINAL_AI_SERVICE_URL;
});

describe('fetchSocialAnalysis', () => {
  test('gets /api/social/analysis from the configured AI_SERVICE_URL and returns the body', async () => {
    axios.get = async (url, opts) => {
      expect(url).toBe('http://ai-service.test/api/social/analysis');
      expect(opts).toEqual({ timeout: 20000 });
      return { data: { overall_sentiment: 'bullish', sample_size: 42 } };
    };
    const result = await fetchSocialAnalysis();
    expect(result).toEqual({ overall_sentiment: 'bullish', sample_size: 42 });
  });

  test('returns null (not a throw) when ai-service is unreachable', async () => {
    axios.get = async () => { throw new Error('ECONNREFUSED'); };
    await expect(fetchSocialAnalysis()).resolves.toBeNull();
  });
});

describe('fetchSocialAlerts', () => {
  test('gets /api/social/alerts from the configured AI_SERVICE_URL and returns the body', async () => {
    axios.get = async (url, opts) => {
      expect(url).toBe('http://ai-service.test/api/social/alerts');
      expect(opts).toEqual({ timeout: 10000 });
      return { data: { alerts: [] } };
    };
    const result = await fetchSocialAlerts();
    expect(result).toEqual({ alerts: [] });
  });

  test('returns null on failure', async () => {
    axios.get = async () => { throw new Error('timeout'); };
    await expect(fetchSocialAlerts()).resolves.toBeNull();
  });
});
