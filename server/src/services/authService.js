import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User, Credential } from '../models/index.js';
import { audit } from './auditService.js';
import { HttpError } from '../middleware/errors.js';

export const SESSION_COOKIE = 'mfa_session';
export const MFA_COOKIE = 'mfa_pending';
const BCRYPT_COST = env.NODE_ENV === 'test' ? 4 : 12;
// Compared against when the account does not exist, so response time does not reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST);

/** Account lockout after repeated failures (docs/DECISIONS.md D24). In-memory per API process. */
const LOCK_THRESHOLD = 5;
const LOCK_MS = 15 * 60 * 1000;
const failures = new Map();

function lockState(key) {
  const f = failures.get(key);
  if (f?.lockedUntil && f.lockedUntil > Date.now()) return f;
  if (f?.lockedUntil) failures.delete(key);
  return null;
}

function recordFailure(key) {
  const f = failures.get(key) ?? { count: 0, lockedUntil: null };
  f.count += 1;
  if (f.count >= LOCK_THRESHOLD) f.lockedUntil = Date.now() + LOCK_MS;
  failures.set(key, f);
  return f;
}

export const resetLockouts = () => failures.clear();

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function register({ username, email, password }, meta = {}) {
  const exists = await User.findOne({ $or: [{ username }, { email: email.toLowerCase() }] }).lean();
  if (exists)
    throw new HttpError(
      409,
      'An account with that username or email already exists',
      'ACCOUNT_EXISTS',
    );
  const user = await User.create({ username, email, passwordHash: await hashPassword(password) });
  await audit(user._id, 'auth.registered', meta);
  return user;
}

/**
 * First factor: username or email + password.
 * @returns {Promise<{ user: any, mfa: null | { method: string, credentialId: string } }>}
 */
export async function login({ identifier, password }, meta = {}) {
  const key = identifier.toLowerCase();
  if (lockState(key)) {
    await audit(null, 'auth.login_locked', { identifier: key, ...meta });
    throw new HttpError(429, 'Too many failed attempts. Try again later.', 'ACCOUNT_LOCKED');
  }
  const user = await User.findOne({ $or: [{ username: identifier }, { email: key }] }).select(
    '+passwordHash',
  );
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    const f = recordFailure(key);
    await audit(user?._id ?? null, 'auth.login_failed', {
      identifier: key,
      attempt: f.count,
      locked: Boolean(f.lockedUntil),
      ...meta,
    });
    throw new HttpError(401, 'Invalid username/email or password', 'INVALID_CREDENTIALS');
  }
  if (user.status !== 'active') {
    await audit(user._id, 'auth.login_blocked_suspended', meta);
    throw new HttpError(403, 'This account is suspended', 'ACCOUNT_SUSPENDED');
  }
  failures.delete(key);
  const factor = await Credential.findOne({
    userId: user._id,
    isLoginFactor: true,
    status: 'active',
  }).lean();
  await audit(user._id, factor ? 'auth.password_verified_mfa_required' : 'auth.login_succeeded', {
    ...meta,
    method: factor?.protocol ?? 'password',
  });
  return {
    user,
    mfa: factor ? { method: factor.protocol, credentialId: String(factor._id) } : null,
  };
}

export function issueSessionToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role, typ: 'session' }, env.JWT_SECRET, {
    expiresIn: env.JWT_TTL_SECONDS,
    algorithm: 'HS256',
  });
}

export function issueMfaToken(user, mfa) {
  return jwt.sign(
    { sub: String(user._id), typ: 'mfa', method: mfa.method, cid: mfa.credentialId },
    env.JWT_SECRET,
    { expiresIn: 300, algorithm: 'HS256' },
  );
}

function decode(token, typ) {
  if (!token) return null;
  try {
    const claims = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    return claims.typ === typ ? claims : null;
  } catch {
    return null;
  }
}

/** Resolve a session cookie to an active user (or null). The role is re-read from the database. */
export async function verifySessionToken(token) {
  const claims = decode(token, 'session');
  if (!claims) return null;
  const user = await User.findById(claims.sub);
  if (!user || user.status !== 'active') return null;
  return user.toSafeJSON();
}

export function verifyMfaToken(token) {
  return decode(token, 'mfa');
}

export const cookieOptions = (maxAgeSeconds) => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'strict',
  path: '/',
  maxAge: maxAgeSeconds * 1000,
});
