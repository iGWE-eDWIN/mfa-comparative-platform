import { AuditLog } from '../models/index.js';
import { logger } from '../config/logger.js';

/** Keys never written to audit details, whatever the caller passes. */
const FORBIDDEN = /pass|secret|code|otp|token|hash|key|signature/i;

function scrub(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => !FORBIDDEN.test(k))
      .map(([k, v]) => [k, scrub(v, depth + 1)]),
  );
}

/**
 * Record a security-relevant event (FR11). Failures to write the audit log are logged but never
 * break the user's request.
 * @param {string|import('mongoose').Types.ObjectId|null} userId
 * @param {string} action dotted name, e.g. auth.login_succeeded
 * @param {object} [details]
 */
export async function audit(userId, action, details = {}) {
  try {
    await AuditLog.create({
      userId: userId ?? null,
      action,
      details: scrub(details),
      timestamp: new Date(),
    });
  } catch (err) {
    logger.error({ err, action }, 'audit write failed');
  }
}

/** Request metadata worth keeping with an audit event. */
export const reqMeta = (req) => ({
  ip: req.ip,
  userAgent: req.get('user-agent')?.slice(0, 200) ?? null,
});
