// CORS origin-resolution logic, extracted from app.js so it can be unit
// tested directly (in milliseconds) instead of only via a full Express app
// boot (which takes tens of seconds on this codebase because app.js pulls in
// all ~30 route files, their controllers/services/models, and mongoose).

/**
 * Build the `cors` package options object from the ALLOWED_ORIGINS env var.
 *
 * Owner decision (2026-08-18): production must use an explicit allowlist,
 * not a wildcard. Behavior:
 * - unset / empty => allowlist is empty. No browser-based cross-origin
 *   request is permitted. This is the safe default until a real production
 *   web origin exists — there is currently no deployed web frontend for
 *   this app (mobile/web/ is unused flutter-create scaffolding, never
 *   customized or hosted anywhere; see DEPLOYMENT.md).
 * - a comma-separated list of exact origins => only those are allowed, and
 *   credentialed requests are permitted.
 * - `*` present in the list => allow any origin, no credentials. Only
 *   intended for local development (see backend/.env.example) — production
 *   config (backend/.env.railway) must not set this.
 * - requests with no Origin header (native mobile clients, curl, server-to-
 *   server) are always allowed, regardless of the list, since there's no
 *   browser-enforced same-origin policy to circumvent for those callers.
 *   Flutter mobile does not send an Origin header, so it is unaffected by
 *   the allowlist either way.
 *
 * @param {string} [originsEnv] raw ALLOWED_ORIGINS env var value
 * @returns {{ origin: Function, credentials: boolean }}
 */
function buildCorsOptions(originsEnv) {
  const allowedOrigins = (originsEnv || '').split(',').map((s) => s.trim()).filter(Boolean);
  const wildcard = allowedOrigins.includes('*');

  return {
    origin: (origin, cb) => {
      if (wildcard || !origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
    credentials: !wildcard,
  };
}

module.exports = { buildCorsOptions };
