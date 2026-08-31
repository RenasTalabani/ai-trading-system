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
      // T-089 (2026-09-01): raised from 20000 -- this endpoint calls
      // ai-service's social_analyzer.refresh() with no timeout guard of
      // its own, and that call was confirmed live to take 35s+ under the
      // current memory-constrained container (same root cause as T-086/
      // T-088). 20s was cutting it off before it could ever succeed.
      expect(opts).toEqual({ timeout: 90000 });
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
      // T-089 (2026-09-01): same reasoning as fetchSocialAnalysis above --
      // this endpoint hits the identical unbounded social_analyzer.refresh()
      // call, just via a different route.
      expect(opts).toEqual({ timeout: 90000 });
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
