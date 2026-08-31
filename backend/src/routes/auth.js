const express = require('express');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const { register, login, getMe, updateFcmToken } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

// T-082 (2026-08-31): /auth/login previously had no rate limit of its
// own -- only the global app-wide limiter (100 req/15min per IP,
// app.js), shared with every other endpoint, meaning a password-guessing
// attempt had the same budget as normal API traffic. This is a
// dedicated, stricter limiter on login specifically: 10 attempts per
// 15 minutes per IP. Deliberately not applied to /register (a
// registration-spam limit is a different, separate policy question, not
// bundled in here) or to the other routes -- narrowly scoped to the one
// gap actually identified.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please try again in a few minutes.' },
});

router.post(
  '/register',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  validate,
  register
);

router.post(
  '/login',
  loginLimiter,
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  login
);

router.get('/me', protect, getMe);
router.patch('/fcm-token', protect, updateFcmToken);

module.exports = router;
