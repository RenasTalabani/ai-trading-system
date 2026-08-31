/**
 * T-082 (2026-08-31): /auth/login previously shared only the global,
 * app-wide rate limiter (100 req/15min per IP) with every other
 * endpoint -- no login-specific brute-force protection. Added a
 * dedicated limiter (10 attempts/15min per IP) directly on the login
 * route. These tests exercise the real router (supertest), not a mock,
 * so the limiter's actual behavior is what's being proven.
 */
const express = require('express');
const request = require('supertest');

jest.mock('../src/controllers/authController', () => ({
  register: (req, res) => res.status(201).json({ success: true }),
  // Always "fails" auth -- the point of these tests is the rate limiter
  // itself, not real credential checking.
  login: (req, res) => res.status(401).json({ success: false, message: 'Invalid credentials' }),
  getMe: (req, res) => res.json({ success: true }),
  updateFcmToken: (req, res) => res.json({ success: true }),
}));

const authRouter = require('../src/routes/auth');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/auth', authRouter);
  return a;
}

describe('POST /auth/login — dedicated rate limit (T-082)', () => {
  test('the first 10 attempts from one IP are not blocked by the limiter (may still fail auth)', async () => {
    const a = app();
    for (let i = 0; i < 10; i++) {
      const res = await request(a).post('/auth/login').send({ email: 'x@example.com', password: 'wrong' });
      expect(res.status).not.toBe(429);
    }
  });

  test('the 11th attempt within the window is blocked with 429', async () => {
    const a = app();
    for (let i = 0; i < 10; i++) {
      await request(a).post('/auth/login').send({ email: 'x@example.com', password: 'wrong' });
    }
    const res = await request(a).post('/auth/login').send({ email: 'x@example.com', password: 'wrong' });
    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/too many login attempts/i);
  });

  test('/register is unaffected by the login limiter (separate policy, not bundled in)', async () => {
    const a = app();
    for (let i = 0; i < 12; i++) {
      const res = await request(a).post('/auth/register').send({ name: 'X', email: `u${i}@example.com`, password: 'password123' });
      expect(res.status).not.toBe(429);
    }
  });
});
