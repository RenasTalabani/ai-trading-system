/**
 * Regression guard for a real production bug (2026-09-04, overnight
 * continuous-improvement pass): VirtualTrade.origin's enum never listed
 * 'ai_worker_approved', even though aiWorkerService.js's approveDecision()
 * and approveAllocationProposal() -- the two functions behind the app's
 * main "Approve" button for an AI-worker-proposed decision/allocation
 * option (master-plan decisions #11 + #14) -- both pass exactly that string
 * into approveSuggestion() -> VirtualTrade.create(). Every real approval of
 * an AI-worker proposal therefore threw a Mongoose ValidationError instead
 * of opening the trade, breaking the app's primary "AI proposes -> human
 * approves" flow end-to-end. Unlike the dca_buy_due/proposal_expired
 * notification bug (see notificationTypeEnum.test.js), this one is NOT
 * silently swallowed anywhere -- approveSuggestion() doesn't catch it, and
 * neither does approveDecision()/approveAllocationProposal() (they only
 * catch a `isSafetyGateRejection`-flagged error to annotate it, then
 * re-throw everything else) -- so it surfaces to the caller as a hard
 * error/500, not a silent no-op. It went unnoticed purely because
 * aiWorkerService.test.js stubs `VirtualTrade.create` with a plain object
 * literal (`async (doc) => ({ ...doc, _id: ... })`) that never runs real
 * Mongoose schema validation, so no existing test could ever have caught
 * this. This suite instead fakes `mongoose` itself (Schema/model) so
 * requiring the real, unmodified src/models/VirtualTrade.js runs its actual
 * enum declaration through a validator that reproduces Mongoose's own
 * documented behavior: an `enum` on a String path rejects any value not
 * listed.
 */
function validateAgainstSchema(schemaDef, doc) {
  const out = {};
  for (const [key, spec] of Object.entries(schemaDef)) {
    if (!(key in doc)) continue;
    const value = doc[key];
    if (spec && typeof spec === 'object' && !Array.isArray(spec) && spec.enum) {
      if (!spec.enum.includes(value)) {
        throw new Error(`ValidationError: \`${value}\` is not a valid enum value for path \`${key}\`.`);
      }
    }
    out[key] = value;
  }
  return out;
}

jest.mock('mongoose', () => {
  class FakeSchema {
    constructor(def) { this.def = def; }
    index() { return this; }
    virtual() { return { get() { return this; }, set() { return this; } }; }
    pre() { return this; }
    post() { return this; }
  }
  return {
    Schema: Object.assign(FakeSchema, { Types: { ObjectId: 'ObjectId', Mixed: 'Mixed' } }),
    model: (name, schema) => ({
      create: async (doc) => validateAgainstSchema(schema.def, doc),
    }),
  };
});

const VirtualTrade = require('../src/models/VirtualTrade');

describe('VirtualTrade.origin enum (2026-09-04 regression)', () => {
  test('ai_worker_approved (aiWorkerService.js approveDecision/approveAllocationProposal) passes validation', async () => {
    const doc = await VirtualTrade.create({
      source: 'ai', origin: 'ai_worker_approved', asset: 'BTCUSDT', direction: 'BUY',
      entryPrice: 60000, sizeUsd: 25,
    });
    expect(doc.origin).toBe('ai_worker_approved');
  });

  test('pre-existing origin values (guide_approval, ai_worker, conversation_approval, futures_manual, signal_auto_pickup) still work unchanged', async () => {
    for (const origin of ['guide_approval', 'ai_worker', 'conversation_approval', 'futures_manual', 'signal_auto_pickup']) {
      const doc = await VirtualTrade.create({
        source: 'guide', origin, asset: 'ETHUSDT', direction: 'SELL', entryPrice: 3000, sizeUsd: 25,
      });
      expect(doc.origin).toBe(origin);
    }
  });

  test('an unlisted origin is still rejected — this fix does not just remove enum enforcement', async () => {
    await expect(VirtualTrade.create({
      source: 'ai', origin: 'not_a_real_origin', asset: 'BTCUSDT', direction: 'BUY',
      entryPrice: 60000, sizeUsd: 25,
    })).rejects.toThrow(/ValidationError/);
  });

  test('a trade with no origin at all (pre-existing/undocumented paths) is still allowed — field has no `required`', async () => {
    const doc = await VirtualTrade.create({
      source: 'signal', asset: 'BTCUSDT', direction: 'BUY', entryPrice: 60000, sizeUsd: 25,
    });
    expect(doc.origin).toBeUndefined();
  });
});
