// CORS origin-resolution logic, extracted from app.js so it can be unit
// tested directly (in milliseconds) instead of only via a full Express app
// boot (which takes tens of seconds on this codebase because app.js pulls in
// all ~30 route files, their controllers/services/models, and mongoose).
// No behavior change from the inline version this replaces.

/**
 * Build the `cors` package options object from the ALLOWED_ORIGINS env var.
 * - `*` (or unset) => allow any origin, no credentials (current production
 *   default; safe here because auth uses Bearer tokens, not cookies, and the
 *   native mobile client sends no Origin header at all).
 * - a comma-separated list => only those exact origins are allowed, and
 *   credentialed requests are permitted.
 * - requests with no Origin header (native mobile clients, curl, server-to-
 *   server) are always allowed, regardless of the list, since there's no
 *   browser-enforced same-origin policy to circumvent for those callers.
 *
 * @param {string} [originsEnv] raw ALLOWED_ORIGINS env var value
 * @returns {{ origin: Function, credentials: boolean }}
 */
function buildCorsOptions(originsEnv) {
  const allowedOrigins = (originsEnv || '*').split(',').filter(Boolean);
  const corsAll = allowedOrigins.includes('*');

  return {
    origin: (origin, cb) => {
      if (corsAll || !origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
    credentials: !corsAll,
  };
}

module.exports = { buildCorsOptions };
