import pino from 'pino';
import { env } from './env.js';

/**
 * Structured logger. Secrets, OTP codes and credentials are redacted by path so that
 * an accidental `logger.info({ body })` can never write them to disk (Chapter 3 §3.11).
 */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'password',
      '*.password',
      'passwordHash',
      '*.passwordHash',
      'code',
      '*.code',
      'otp',
      '*.otp',
      'secret',
      '*.secret',
      'token',
      '*.token',
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
    ],
    censor: '[REDACTED]',
  },
});
