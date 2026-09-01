/**
 * AUDIT-01 (2026-09-01, production audit): logger.js's format only ever
 * read {level, message, timestamp, stack} off winston's `info` object --
 * a call like `logger.error('X failed for BTCUSDT:', err.message)` (the
 * dominant error-logging pattern across this whole codebase: aiService.js,
 * binanceService.js, socialService.js, and dozens more) passes that second
 * argument as a winston "splat" arg, stored under info[Symbol.for('splat')]
 * rather than merged into `message` -- and since the format never read
 * that symbol, the actual error detail was silently dropped from every
 * one of those log lines, in every environment, this whole session.
 *
 * These tests build a real winston logger using this project's actual
 * format config (not a reimplementation) with a Stream transport that
 * captures the rendered output, so they exercise the exact code path
 * production logging goes through.
 */
const { Writable } = require('stream');
const winston = require('winston');

// Re-require the real module under test rather than duplicating its
// format logic -- but logger.js exports a ready-made logger with Console
// + File transports already attached, which isn't practical to assert
// against directly (no easy hook into stdout in Jest, and File transports
// would touch the real filesystem). So this rebuilds a logger using the
// exact same `combine(timestamp(), errors({stack:true}), logFormat)`
// pieces by requiring logger.js's module and reaching its format via a
// captured Stream transport instead -- verifying the real, shipped
// `logger` instance's actual formatting behavior, not a copy of it.
const logger = require('../src/config/logger');

function captureOutput() {
  const lines = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const transport = new winston.transports.Stream({ stream, level: 'info' });
  logger.add(transport);
  return { lines, remove: () => logger.remove(transport) };
}

describe('logger — splat args are no longer silently dropped (AUDIT-01)', () => {
  test('a two-argument call renders the second argument in the output', () => {
    const { lines, remove } = captureOutput();
    logger.error('Historical data collection failed for BTCUSDT:', 'Request failed with status code 451');
    remove();

    expect(lines[0]).toContain('Historical data collection failed for BTCUSDT:');
    expect(lines[0]).toContain('Request failed with status code 451');
  });

  test('a plain single-argument message is completely unaffected', () => {
    const { lines, remove } = captureOutput();
    logger.info('Plain message with no extra args');
    remove();

    expect(lines[0]).toContain('Plain message with no extra args');
    expect(lines[0].trim().endsWith('Plain message with no extra args')).toBe(true);
  });

  test('a real Error object as the sole argument still uses its stack trace, not the splat path', () => {
    const { lines, remove } = captureOutput();
    logger.error(new Error('boom'));
    remove();

    expect(lines[0]).toContain('Error: boom');
    expect(lines[0]).toMatch(/at /); // stack trace present
  });

  test('an object passed as the second argument is rendered as JSON, not [object Object]', () => {
    const { lines, remove } = captureOutput();
    logger.warn('Something happened:', { code: 'ECONNRESET', retries: 2 });
    remove();

    expect(lines[0]).toContain('Something happened:');
    expect(lines[0]).toContain('"code":"ECONNRESET"');
    expect(lines[0]).not.toContain('[object Object]');
  });
});
