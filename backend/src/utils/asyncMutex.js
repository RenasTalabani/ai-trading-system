/**
 * Minimal async mutex for serializing access to a shared in-process
 * resource. See `portfolioLock.js` for the concrete bug this exists to
 * close (a real, currently-live data-integrity race in the paper-trading
 * balance).
 *
 * Deliberately NOT a distributed lock (e.g. a Mongo-based lock document):
 * this app runs as a single Node process / single Railway service instance
 * per CLAUDE.md's architecture, not horizontally scaled, so an in-process
 * mutex fully closes the race for the actual deployment model. If this app
 * is ever scaled to multiple instances, balance mutations need to move to
 * atomic MongoDB `$inc` operations (or a real distributed lock) instead --
 * noting that here so it isn't forgotten later.
 */
class AsyncMutex {
  constructor() {
    this._queue = Promise.resolve();
  }

  /**
   * Runs `fn` only after every previously-queued `run()` call on this same
   * mutex has fully settled (whether it resolved or rejected), and queues
   * anything scheduled after it the same way. Returns (or rejects with)
   * fn's own result -- callers see fn's real outcome, not a swallowed one.
   */
  run(fn) {
    const result = this._queue.then(fn);
    // Chain the queue itself off a version of `result` that never rejects,
    // so one caller's error can't permanently wedge the mutex for anyone
    // queued behind it.
    this._queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
}

module.exports = { AsyncMutex };
