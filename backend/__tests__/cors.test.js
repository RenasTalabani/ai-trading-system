// CORS policy tests.
//
// Two layers, deliberately kept separate for speed:
// 1. Unit tests against `buildCorsOptions` (src/config/corsConfig.js) — the
//    actual origin-resolution logic app.js uses. Fast (no app boot).
// 2. One integration test that mounts a minimal Express app using the same
//    `cors(buildCorsOptions(...))` call app.js makes, and drives it with
//    real HTTP requests via supertest — proves the `cors` package actually
//    enforces what the options object claims, without paying the cost of
//    booting the full app (~30 route files, controllers, services, models)
//    just to exercise CORS.
//
// This does not change the CORS policy itself — that's an operational/
// product decision (see DEPLOYMENT.md) — it only verifies the enforcement
// code is correct.

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

  test('wildcard (default / current production value) allows any origin, no credentials', async () => {
    const opts = buildCorsOptions('*');
    expect(opts.credentials).toBe(false);
    const { err, allow } = await originAllowed('*', 'https://totally-unrelated-site.example');
    expect(err).toBeNull();
    expect(allow).toBe(true);
  });

  test('unset ALLOWED_ORIGINS behaves the same as wildcard', async () => {
    const opts = buildCorsOptions(undefined);
    expect(opts.credentials).toBe(false);
    const { err, allow } = await originAllowed(undefined, 'https://anything.example');
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
});

describe('CORS wired into a real HTTP request (integration, single app instance)', () => {
  // Mirrors exactly how app.js mounts CORS: app.use(cors(buildCorsOptions(...)))
  function makeApp(originsEnv) {
    const app = express();
    app.use(cors(buildCorsOptions(originsEnv)));
    app.get('/probe', (req, res) => res.json({ ok: true }));
    // cors() surfaces a rejected origin as a request-level error — needs an
    // error handler or supertest sees a raw 500 with no CORS header, which is
    // still the assertion we want (no access-control-allow-origin header).
    app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));
    return app;
  }

  test('wildcard allows a cross-origin browser request', async () => {
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

  test('explicit allowlist rejects an origin not on the list at the HTTP layer', async () => {
    const app = makeApp('https://app.example.com');
    const res = await request(app).get('/probe').set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('no Origin header (native mobile) is allowed at the HTTP layer', async () => {
    const app = makeApp('https://app.example.com');
    const res = await request(app).get('/probe');
    expect(res.status).toBe(200);
  });
});
