/**
 * Regression guard for a real production bug (2026-09-04, overnight
 * continuous-improvement pass): Notification.type's enum never listed
 * 'dca_buy_due' or 'proposal_expired', even though
 * notificationService.sendDcaBuyDueNotification()/
 * sendProposalExpiredNotification() both pass exactly those values to
 * persistTradeEventNotification() -> Notification.create(). Every such
 * create() call therefore failed Mongoose's own enum validation on every
 * single invocation -- and because persistTradeEventNotification() wraps
 * each per-user create() in its own `.catch(() => null)` (so one user's
 * failure never blocks the others), that ValidationError was swallowed with
 * zero trace anywhere: both features read as fully wired up but silently
 * produced no in-app notification at all. Same root-cause shape as BUG-004
 * (see notificationServiceTradeEvents.test.js), which is exactly why THAT
 * suite's approach -- mocking Notification.create() away entirely -- can
 * never catch this class of bug: it never exercises the real schema.
 *
 * This suite instead fakes `mongoose` itself (Schema/model), so requiring
 * the real, unmodified src/models/Notification.js runs its actual enum +
 * embedded-object-field declarations through a validator that reproduces
 * Mongoose's own documented behavior for both: an `enum` on a String path
 * rejects any value not listed, and a plain nested-object path (the default
 * "strict" embedded-document mode) silently drops any key not declared in
 * that sub-schema. This cannot spin up a real MongoDB (mongoose itself is
 * not installed in the environment this suite was authored in), but it
 * catches exactly the two ways this bug actually manifested, which no
 * amount of mocking Notification.create() directly ever could.
 */
function mockValidateAgainstSchema(schemaDef, doc) {
  const out = {};
  for (const [key, spec] of Object.entries(schemaDef)) {
    if (!(key in doc)) continue;
    const value = doc[key];
    if (spec && typeof spec === 'object' && !Array.isArray(spec) && spec.enum) {
      if (!spec.enum.includes(value)) {
        throw new Error(`ValidationError: \`${value}\` is not a valid enum value for path \`${key}\`.`);
      }
    }
    if (key === 'data' && value && typeof value === 'object') {
      const declared = Object.keys(spec);
      const kept = {};
      for (const k of Object.keys(value)) if (declared.includes(k)) kept[k] = value[k];
      out[key] = kept;
      continue;
    }
    out[key] = value;
  }
  return out;
}

jest.mock('mongoose', () => {
  class FakeSchema {
    constructor(def) { this.def = def; }
    index() { return this; }
  }
  return {
    Schema: Object.assign(FakeSchema, { Types: { ObjectId: 'ObjectId' } }),
    model: (name, schema) => ({
      create: async (doc) => mockValidateAgainstSchema(schema.def, doc),
    }),
  };
});

const Notification = require('../src/models/Notification');

describe('Notification.type enum (2026-09-04 regression)', () => {
  test('dca_buy_due passes validation and keeps its payload fields', async () => {
    const doc = await Notification.create({
      userId: 'u1', type: 'dca_buy_due', title: 't', body: 'b',
      data: { planId: 'plan1', asset: 'BTCUSDT', amountUsd: 25 },
    });
    expect(doc.type).toBe('dca_buy_due');
    expect(doc.data.planId).toBe('plan1');
    expect(doc.data.amountUsd).toBe(25);
  });

  test('proposal_expired passes validation and keeps its payload fields', async () => {
    const doc = await Notification.create({
      userId: 'u1', type: 'proposal_expired', title: 't', body: 'b',
      data: { proposalId: 'p1', assets: ['BTCUSDT', 'ETHUSDT'] },
    });
    expect(doc.type).toBe('proposal_expired');
    expect(doc.data.proposalId).toBe('p1');
    expect(doc.data.assets).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  test('an unlisted type is still rejected — this fix does not just remove enum enforcement', async () => {
    await expect(Notification.create({
      userId: 'u1', type: 'not_a_real_type', title: 't', body: 'b', data: {},
    })).rejects.toThrow(/ValidationError/);
  });

  test('pre-existing trade_closed notifications (BUG-004) still work unchanged', async () => {
    const doc = await Notification.create({
      userId: 'u1', type: 'trade_closed', title: 't', body: 'b',
      data: { tradeId: 'tr1', pnl: 12.5, pnlPct: 3.1, exitReason: 'TP' },
    });
    expect(doc.data.pnl).toBe(12.5);
    expect(doc.data.exitReason).toBe('TP');
  });
});
