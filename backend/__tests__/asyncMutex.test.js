const { AsyncMutex } = require('../src/utils/asyncMutex');

function delay(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe('AsyncMutex', () => {
  test('serializes overlapping critical sections instead of letting them interleave (the actual bug this closes)', async () => {
    const mutex = new AsyncMutex();
    let shared = 0;
    const order = [];

    // Simulates the real race: two "critical sections" each read a shared
    // value, await (a stand-in for a DB round trip / other async work),
    // then write back read+1. Without the mutex, both reads would see 0
    // and both writes would land 1 -- a lost update. With it, they must
    // fully serialize: 0 -> 1 -> 2.
    async function criticalSection(label, readDelayMs) {
      return mutex.run(async () => {
        order.push(`${label}:start`);
        const before = shared;
        await delay(readDelayMs);
        shared = before + 1;
        order.push(`${label}:end`);
        return shared;
      });
    }

    // Fire both "concurrently" -- B starts before A has resolved.
    const pA = criticalSection('A', 30);
    const pB = criticalSection('B', 5);

    const [resultA, resultB] = await Promise.all([pA, pB]);

    expect(shared).toBe(2); // not 1 -- proves no lost update
    expect(resultA).toBe(1); // A ran first (queued first), got the pre-race value
    expect(resultB).toBe(2); // B ran second, saw A's already-applied update
    // B must not start until A has fully finished -- that's the actual
    // serialization guarantee, not just the final count being right.
    expect(order).toEqual(['A:start', 'A:end', 'B:start', 'B:end']);
  });

  test('a rejected critical section does not wedge the mutex for work queued behind it', async () => {
    const mutex = new AsyncMutex();

    const failing = mutex.run(async () => {
      throw new Error('boom');
    });
    const after = mutex.run(async () => 'still works');

    await expect(failing).rejects.toThrow('boom');
    await expect(after).resolves.toBe('still works');
  });

  test('each run() call still resolves with its own function\'s real return value', async () => {
    const mutex = new AsyncMutex();
    const results = await Promise.all([
      mutex.run(async () => 1),
      mutex.run(async () => 2),
      mutex.run(async () => 3),
    ]);
    expect(results).toEqual([1, 2, 3]);
  });
});
