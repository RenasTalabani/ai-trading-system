/**
 * Regression guard for a real race in aiWorkerService.js's
 * approveAllocationProposal() (2026-09-04, overnight continuous-improvement
 * pass): the original version read proposal.status, checked
 * PENDING_APPROVAL, then did a long sequence of real async work (one
 * approveSuggestion() call per allocation) before ever writing
 * proposal.status back. Two concurrent approvals for the SAME proposal --
 * a double-tap, or two different option buttons tapped before the first
 * response lands -- could both pass that check, race on the final
 * proposal.save() (lost update), and worse, race on AIDecision.updateOne()
 * (a losing allocation's unconditional REJECTED write could stomp a
 * decision the other concurrent call had already marked APPROVED with a
 * real tradeId).
 *
 * Fixed with an atomic findOneAndUpdate claim instead of a lock (a lock
 * would deadlock here -- approveSuggestion() already holds the same
 * shared portfolio mutex, which isn't reentrant). This suite verifies the
 * claim itself is atomic: two concurrent calls for the same proposal, and
 * exactly one is allowed to run the allocation loop at all -- the other
 * is rejected immediately, before touching any AIDecision record.
 *
 * approveSuggestion() itself is mocked here (it's already covered by its
 * own dedicated race suite, virtualTrackingServiceApproveRace.test.js) --
 * this suite is specifically about the proposal-level claim, not
 * re-testing the per-asset trade-opening lock.
 */
jest.mock('../src/services/virtualTrackingService', () => ({
  approveSuggestion: jest.fn(async ({ asset }) => {
    await mockDelay(5);
    return { _id: 'trade_' + asset, asset };
  }),
  computeSpotSizeUsd: jest.fn(),
}));
jest.mock('../src/jobs/globalScanJob', () => ({ getCache: () => null }));
jest.mock('../src/services/allocationOptionsBuilder', () => ({ buildAllocationOptions: () => [] }));

const AllocationProposal = require('../src/models/AllocationProposal');
const AIDecision         = require('../src/models/AIDecision');

function mockDelay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function makeProposal(overrides = {}) {
  const p = {
    _id: 'prop1',
    status: 'PENDING_APPROVAL',
    options: [
      {
        key: 'optA',
        allocations: [
          { asset: 'AAAUSDT', direction: 'BUY', amountUsd: 50, entryPrice: 100, aiDecisionId: 'dec1' },
        ],
      },
      {
        key: 'optB',
        allocations: [
          { asset: 'BBBUSDT', direction: 'BUY', amountUsd: 50, entryPrice: 200, aiDecisionId: 'dec2' },
        ],
      },
    ],
    ...overrides,
  };
  // Kept for parity with the pre-fix code path (which read via findById and
  // called proposal.save() directly) -- not used by the fixed code (which
  // uses findOneAndUpdate/updateOne instead), but having it here means this
  // same test file can also run, unmodified, against the pre-fix function
  // to demonstrate the race it used to have.
  p.save = async function () { await mockDelay(10); return p; };
  return p;
}

let FAKE_PROPOSALS, AI_DECISION_WRITES;

beforeEach(() => {
  FAKE_PROPOSALS = [];
  AI_DECISION_WRITES = [];

  // Models a real MongoDB findOneAndUpdate accurately: the check-and-modify
  // is atomic and happens the instant the "command" is processed (i.e.
  // synchronously, before any await in this mock) -- only the artificial
  // network-round-trip mockDelay happens afterward. This is what makes the
  // claim genuinely race-proof to test, unlike a mock that checks-then-
  // waits-then-writes (which would just reintroduce the same TOCTOU gap
  // this fix closes, inside the mock itself).
  AllocationProposal.findOneAndUpdate = async (filter, update, opts) => {
    const doc = FAKE_PROPOSALS.find((p) => p._id === filter._id);
    if (!doc || doc.status !== filter.status) {
      await mockDelay(10);
      return null;
    }
    const before = { ...doc };
    Object.assign(doc, update);
    await mockDelay(10);
    return opts && opts.new ? { ...doc } : before;
  };
  AllocationProposal.updateOne = async (filter, update) => {
    const doc = FAKE_PROPOSALS.find((p) => p._id === filter._id);
    if (doc) Object.assign(doc, update);
    await mockDelay(5);
  };
  AllocationProposal.findById = async (id) => FAKE_PROPOSALS.find((p) => p._id === id) || null;

  AIDecision.updateOne = async (filter, update) => {
    AI_DECISION_WRITES.push({ filter, update });
    await mockDelay(5);
  };
  AIDecision.updateMany = async () => { await mockDelay(5); };
});

const svc = require('../src/services/aiWorkerService');

describe('approveAllocationProposal — concurrent-approval race (2026-09-04 regression)', () => {
  test('two near-simultaneous approvals for the SAME proposal (even different options): exactly one is processed, the other is cleanly rejected', async () => {
    FAKE_PROPOSALS = [makeProposal()];

    const results = await Promise.allSettled([
      svc.approveAllocationProposal('prop1', 'optA'),
      svc.approveAllocationProposal('prop1', 'optB'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected  = results.filter((r) => r.status === 'rejected');

    // The real, load-bearing assertion: only ONE call ever got past the
    // atomic claim and ran the allocation loop -- not "both eventually
    // converged to a consistent state", but the second call never even
    // started opening trades.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toMatch(/already approved/i);

    // Exactly one AIDecision write happened (for the one allocation that
    // was actually processed) -- not two conflicting writes for the same
    // decision, and no self-contradictory REJECTED-with-a-tradeId state.
    expect(AI_DECISION_WRITES).toHaveLength(1);
    expect(AI_DECISION_WRITES[0].update.status).toBe('APPROVED');

    // The proposal ended up claimed by exactly one option, matching
    // whichever call actually won.
    const finalProposal = FAKE_PROPOSALS[0];
    expect(['optA', 'optB']).toContain(finalProposal.chosenOptionKey);
  });

  test('two approvals for two DIFFERENT proposals: both succeed independently (the claim does not over-serialize)', async () => {
    FAKE_PROPOSALS = [makeProposal({ _id: 'propA' }), makeProposal({ _id: 'propB' })];

    const results = await Promise.allSettled([
      svc.approveAllocationProposal('propA', 'optA'),
      svc.approveAllocationProposal('propB', 'optA'),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(FAKE_PROPOSALS.every((p) => p.status === 'APPROVED')).toBe(true);
  });
});
