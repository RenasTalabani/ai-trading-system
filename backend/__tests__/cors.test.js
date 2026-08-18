// CORS policy tests.
//
// Owner decision (2026-08-18): production must use an explicit origin
// allowlist, not a wildcard. `ALLOWED_ORIGINS` unset/empty now means "deny
// all browser-based cross-origin requests" (safe default — no web frontend
// is deployed for this app yet), not "allow everything" as it did before.
// `*` is still supported for local development flexibility, but is no
// longer the implicit default and must never be set in production (see
// backend/.env.railway).
//
// Two layers, deliberately kept separate for speed:
// 1. Unit tests against `buildCorsOptions` (src/config/corsConfig.js) — the
//    actual origin-resolution logic app.js uses. Fast (no app boot).
// 2. Integration tests that mount a minimal Express app using the same
//    `cors(buildCorsOptions(...))` call app.js makes, and drive it with
//    real HTTP requests via supertest — proves the `cors` package actually
//    enforces what the options object claims, without paying the cost of
//    booting the full app (~30 route files, controllers, services, models)
//    just to exercise CORS.

const express = require('express');
const cors = require('cors');
const request = require('supertest');
const { buildCorsOptions } = require('../src/config/corsConfig');

describe('buildCorsOptions (unit)', () => {
  function originAllowed(originsEnv, requestOrigin) {
    const opts = buildCorsOptions(originsEnv);
    return new Promise((resolve) => {
      opts.origin(requestOrigin, (err, allow) => resolve({ err, allow }));
    });
  }

  test('unset ALLOWED_ORIGINS (production-safe default) denies a browser origin', async () => {
    // credentials: true here is harmless and consistent with "explicit
    // allowlist mode" (vs. wildcard mode) -- with zero allowed origins, no
    // browser request ever passes the origin check to receive it.
    const opts = buildCorsOptions(undefined);
    expect(opts.credentials).toBe(true);
    const { err, allow } = await originAllowed(undefined, 'https://anything.example');
    expect(err).toBeInstanceOf(Error);
    expect(allow).toBeUndefined();
  });

  test('empty string ALLOWED_ORIGINS behaves the same as unset', async () => {
    const { err, allow } = await originAllowed('', 'https://anything.example');
    expect(err).toBeInstanceOf(Error);
    expect(allow).toBeUndefined();
  });

  test('explicit wildcard (opt-in, dev only) allows any origin, no credentials', async () => {
    const opts = buildCorsOptions('*');
    expect(opts.credentials).toBe(false);
    const { err, allow } = await originAllowed('*', 'https://totally-unrelated-site.example');
    expect(err).toBeNull();
    expect(allow).toBe(true);
  });

  test('explicit allowlist accepts a listed origin and enables credentials', async () => {
    const opts = buildCorsOptions('https://app.example.com,https://admin.example.com');
    expect(opts.credentials).toBe(true);
    const { err, allow } = await originAllowed(
      'https://app.example.com,https://admin.example.com',
      'https://app.example.com'
    );
    expect(err).toBeNull();
    expect(allow).toBe(true);
  });

  test('explicit allowlist rejects an origin not on the list', async () => {
    const { err, allow } = await originAllowed('https://app.example.com', 'https://evil.example.com');
    expect(err).toBeInstanceOf(Error);
    expect(allow).toBeUndefined();
  });

  test('requests with no Origin header (native mobile clients) are always allowed, even with an allowlist', async () => {
    const { err, allow } = await originAllowed('https://app.example.com', undefined);
    expect(err).toBeNull();
    expect(allow).toBe(true);
  });

  test('requests with no Origin header are allowed even with the safe empty default', async () => {
    const { err, allow } = await originAllowed(undefined, undefined);
    expect(err).toBeNull();
    expect(allow).toBe(true);
  });

  test('trims whitespace around comma-separated origins', async () => {
    const { err, allow } = await originAllowed(' https://app.example.com , https://admin.example.com ', 'https://app.example.com');
    expect(err).toBeNull();
    expect(allow).toBe(true);
  });
});

describe('CORS wired into a real HTTP request (integration, single app instance)', () => {
  // Mirrors exactly how app.js mounts CORS: app.use(cors(buildCorsOptions(...)))
  function makeApp(originsEnv) {
    const app = express();
    app.use(cors(buildCorsOptions(originsEnv)));
    app.get('/probe', (req, res) => {
      // Reflects whether an Authorization header made it through, so we can
      // assert CORS rejection happens independently of auth (a rejected
      // origin never even reaches this handler; an allowed one does,
      // authenticated or not).
      res.json({ ok: true, authed: !!req.headers.authorization });
    });
    // cors() surfaces a rejected origin as a request-level error — needs an
    // error handler or supertest sees a raw 500 with no CORS header, which is
    // still the assertion we want (no access-control-allow-origin header).
    app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));
    return app;
  }

  test('production-safe default (unset ALLOWED_ORIGINS) rejects a browser origin at the HTTP layer', async () => {
    const app = makeApp(undefined);
    const res = await request(app).get('/probe').set('Origin', 'https://totally-unrelated-site.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('explicit allowlist accepts a listed origin at the HTTP layer', async () => {
    const app = makeApp('https://app.example.com');
    const res = await request(app).get('/probe').set('Origin', 'https://app.example.com');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
  });

  test('explicit allowlist rejects an origin not on the list at the HTTP layer', async () => {
    const app = makeApp('https://app.example.com');
    const res = await request(app).get('/probe').set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('explicit wildcard (opt-in) allows a cross-origin browser request at the HTTP layer', async () => {
    const app = makeApp('*');
    const res = await request(app).get('/probe').set('Origin', 'https://totally-unrelated-site.example');
    expect(res.status).toBe(200);
    // The `cors` package reflects the request's actual Origin back (rather
    // than a literal "*") whenever `origin` is supplied as a function — this
    // is normal `cors` behavior for a dynamic origin callback, not something
    // corsConfig.js controls. It's equally permissive: every origin gets a
    // matching allow header, which is what "wildcard" means here.
    expect(res.headers['access-control-allow-origin']).toBe('https://totally-unrelated-site.example');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  test('no Origin header (native mobile) is allowed at the HTTP layer, even with the safe empty default', async () => {
    const app = makeApp(undefined);
    const res = await request(app).get('/probe');
    expect(res.status).toBe(200);
  });

  test('authenticated request (Bearer token) from an allowed origin passes through with the auth header intact', async () => {
    const app = makeApp('https://app.example.com');
    const res = await request(app)
      .get('/probe')
      .set('Origin', 'https://app.example.com')
      .set('Authorization', 'Bearer sometoken');
    expect(res.status).toBe(200);
    expect(res.body.authed).toBe(true);
  });

  test('authenticated request (Bearer token) from a disallowed origin is still rejected by CORS', async () => {
    const app = makeApp('https://app.example.com');
    const res = await request(app)
      .get('/probe')
      .set('Origin', 'https://evil.example.com')
      .set('Authorization', 'Bearer sometoken');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
