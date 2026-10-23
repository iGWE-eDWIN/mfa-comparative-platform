import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const common = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { message: 'Too many requests, slow down', code: 'RATE_LIMITED' } },
};
const off = env.NODE_ENV === 'test' && process.env.ENABLE_RATE_LIMITS !== 'true';

/** Login/registration: 20 requests per 15 minutes per IP. */
export const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skip: () => off,
});
/** Second-factor verification and code sending: 30 per 5 minutes per IP. */
export const sensitiveLimiter = rateLimit({
  ...common,
  windowMs: 5 * 60 * 1000,
  limit: 30,
  skip: () => off,
});
/** General API: 600 per minute per IP. */
export const apiLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 600,
  skip: () => off,
});
