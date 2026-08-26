/**
 * Regression suite for T-057 (2026-08-26, overnight continuous-improvement
 * pass). Zero prior test coverage existed for brainController.js.
 *
 * Bug: `_buildAnswer()`'s `asset:<SYMBOL>` branch (reached via
 * `POST /brain/ask` — the "Ask the AI Brain" chat feature — whenever the
 * user's question names a specific asset, e.g. "what about bitcoin?")
 * queried `NewsData.find({ relevantAssets: symbol })`. `relevantAssets` is
 * not a field on the `NewsData` schema at all — the real field (used
 * consistently everywhere else in the codebase: `newsService.js`,
 * `NewsData.js`'s own schema/index, `SocialData.js`'s equivalent field, and
 * `socialService.js`) is `relatedAssets`. A Mongo query on a field name that
 * matches no document's schema returns an empty result silently, with no
 * error — so this branch's response always had an empty `news` array, for
 * every asset, every time, regardless of how much real news existed for
 * that asset. Confirmed via `grep -rn "relevantAssets" backend/src/` that
 * this was the only occurrence of the misspelled field name anywhere in the
 * codebase (a one-off typo, not a systemic pattern) before this fix.
 *
 * Fix: correct the field name to `relatedAssets`, matching the schema and
 * every other caller.
 */
jest.mock('../src/jobs/globalScanJob', () => ({ getCache: jest.fn(() => null) }));

const AIDecision = require('../src/models/AIDecision');
const NewsData   = require('../src/models/NewsData');
const brainController = require('../src/controllers/brainController');

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json   = jest.fn(() => res);
  return res;
}

function chainReturning(value) {
  return { sort: () => ({ limit: () => ({ lean: async () => value }) }) };
}

describe('brainController.askBrain — asset-specific news lookup (T-057)', () => {
  beforeEach(() => {
    AIDecision.find = jest.fn(() => chainReturning([]));
    AIDecision.countDocuments = jest.fn(async () => 0);
    AIDecision.aggregate = jest.fn(async () => []);
    NewsData.find = jest.fn(() => chainReturning([]));
  });

  test('regression: queries NewsData with "relatedAssets" (the real schema field), not "relevantAssets"', async () => {
    const req = { body: { question: 'what about bitcoin?' } };
    const res = mockRes();

    await brainController.askBrain(req, res);

    expect(NewsData.find).toHaveBeenCalledTimes(1);
    const queryArg = NewsData.find.mock.calls[0][0];
    expect(queryArg).toEqual({ relatedAssets: 'BTCUSDT' });
    expect(queryArg).not.toHaveProperty('relevantAssets');
  });

  test('regression: real matching news articles now come through in the response (previously always empty)', async () => {
    NewsData.find = jest.fn(() => chainReturning([
      { title: 'Bitcoin rallies past $70k', source: 'CoinDesk', publishedAt: new Date('2026-08-26') },
    ]));
    const req = { body: { question: 'tell me about btc' } };
    const res = mockRes();

    await brainController.askBrain(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.news).toHaveLength(1);
    expect(payload.data.news[0].title).toBe('Bitcoin rallies past $70k');
  });

  test('non-asset questions (e.g. performance) do not touch NewsData at all', async () => {
    const req = { body: { question: 'how accurate has the AI been?' } };
    const res = mockRes();

    await brainController.askBrain(req, res);

    expect(NewsData.find).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json.mock.calls[0][0].intent).toBe('performance');
  });

  test('missing question returns 400 without touching any model', async () => {
    const req = { body: {} };
    const res = mockRes();

    await brainController.askBrain(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(NewsData.find).not.toHaveBeenCalled();
    expect(AIDecision.find).not.toHaveBeenCalled();
  });
});
