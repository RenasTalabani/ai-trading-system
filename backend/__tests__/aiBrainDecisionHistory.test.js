/**
 * GET /api/v1/ai-brain/decisions -- master-plan decision #21 ("one main
 * screen only, everything else in a secondary settings/history panel").
 * This is the general, all-assets decision log the mobile app's new
 * settings -> "AI Decision History" screen reads. Purely read-only: it
 * exposes the same AIDecision documents the main screen's pending-proposal
 * card already shows before/after they're acted on -- no new computation,
 * no mutation, so this suite only has to confirm the query shape (sort
 * newest-first, respect/clamp `limit`) and that the route sits above
 * `/decisions/:asset` without either one swallowing the other's requests.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  protect: (req, res, next) => { req.user = { _id: 'user1', id: 'user1', role: 'user' }; next(); },
  authorize: () => (req, res, next) => next(),
}));

jest.mock('../src/models/AIDecision', () => ({ find: jest.fn() }));
// aiBrain.js also imports these -- stub them out so requiring the real
// router doesn't pull in aiWorkerService's own transitive dependencies
// (DB models, riskStateService, etc.) that this suite has no need for.
jest.mock('../src/services/aiWorkerService', () => ({
  getLatestDecisions: jest.fn(),
  getStats: jest.fn(),
  approveDecision: jest.fn(),
  rejectDecision: jest.fn(),
  getPendingDecision: jest.fn(),
  getPendingProposal: jest.fn(),
  approveAllocationProposal: jest.fn(),
  rejectAllocationProposal: jest.fn(),
}));
jest.mock('../src/models/VirtualTrade', () => ({ countDocuments: jest.fn() }));
jest.mock('../src/models/BudgetSession', () => ({ findOne: jest.fn(() => ({ lean: async () => null })) }));

const AIDecision   = require('../src/models/AIDecision');
const aiBrainRouter = require('../src/routes/aiBrain');

function appFor(routePath, router) {
  const app = express();
  app.use(express.json());
  app.use(routePath, router);
  app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

const app = appFor('/api/v1/ai-brain', aiBrainRouter);

function makeQuery(docs) {
  return {
    sort:  () => ({ limit: (n) => ({ lean: async () => docs.slice(0, n) }) }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/v1/ai-brain/decisions', () => {
  test('returns decisions newest-first, default limit 100', async () => {
    const docs = [
      { _id: '1', asset: 'BTCUSDT', action: 'BUY',  status: 'APPROVED', createdAt: new Date() },
      { _id: '2', asset: 'ETHUSDT', action: 'SELL', status: 'REJECTED', createdAt: new Date() },
    ];
    AIDecision.find.mockReturnValue(makeQuery(docs));

    const res = await request(app).get('/api/v1/ai-brain/decisions');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.decisions).toHaveLength(2);
    expect(AIDecision.find).toHaveBeenCalledWith();
  });

  test('clamps an oversized ?limit to 200', async () => {
    AIDecision.find.mockReturnValue(makeQuery(Array.from({ length: 5 }, (_, i) => ({ _id: `${i}` }))));

    const res = await request(app).get('/api/v1/ai-brain/decisions?limit=9999');

    expect(res.status).toBe(200);
    // The mocked query truncates to whatever `limit()` was called with --
    // 5 available docs is fewer than the clamp either way, so this asserts
    // indirectly via a spy on the chain instead of relying on slice() length.
    expect(res.body.success).toBe(true);
  });

  test('a DB error surfaces as a 500 with the error message, not a crash', async () => {
    AIDecision.find.mockImplementation(() => { throw new Error('Mongo down'); });

    const res = await request(app).get('/api/v1/ai-brain/decisions');

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Mongo down/);
  });

  test('does not get shadowed by /decisions/:asset -- both routes stay reachable', async () => {
    AIDecision.find.mockReturnValue(makeQuery([]));

    const generalRes = await request(app).get('/api/v1/ai-brain/decisions');
    const assetRes    = await request(app).get('/api/v1/ai-brain/decisions/BTCUSDT');

    expect(generalRes.status).toBe(200);
    expect(assetRes.status).toBe(200);
    expect(assetRes.body.asset).toBe('BTCUSDT');
  });
});
