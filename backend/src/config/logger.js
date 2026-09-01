const winston = require('winston');
const path = require('path');

const { combine, timestamp, printf, colorize, errors } = winston.format;

// AUDIT-01 (2026-09-01, production audit): this format only ever read
// {level, message, timestamp, stack} off the winston `info` object -- a
// call like `logger.error('X failed for BTCUSDT:', err.message)` (the
// dominant error-logging pattern across this whole codebase: aiService.js,
// binanceService.js, socialService.js, and dozens more) passes that second
// argument as a winston "splat" arg, which winston stores under
// info[Symbol.for('splat')] rather than merging into `message` -- and
// since this format never read that symbol, the actual error detail was
// silently dropped from every single one of those log lines, in every
// environment, this whole time. Confirmed directly: the exact same call
// used by binanceService.js's collectHistoricalData() prints only
// "Historical data collection failed for BTCUSDT:" under the old format,
// and "...BTCUSDT: Request failed with status code 451" under this one --
// the real detail was there all along, just never rendered. This is very
// likely why so many log lines investigated tonight showed "reason: "
// with nothing after the colon (some of those, on the ai-service/Python
// side, were legitimately asyncio.TimeoutError's empty str() -- a
// different, correct explanation -- but every affected line on the
// Node/backend side was this).
// Single-argument calls (the common case) and calls with a lone Error
// object (which already correctly uses `.stack` via the `errors()`
// format below) are both unaffected -- verified with the real winston
// version installed here before applying this.
const logFormat = printf((info) => {
  const { level, message, timestamp, stack } = info;
  const splatArgs = info[Symbol.for('splat')];
  const extra = splatArgs && splatArgs.length
    ? ' ' + splatArgs
        .map((a) => (a instanceof Error ? a.message
          : (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))))
        .join(' ')
    : '';
  return `${timestamp} [${level}]: ${stack || message}${extra}`;
});

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), logFormat),
    }),
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/combined.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 10,
    }),
  ],
});

module.exports = logger;
