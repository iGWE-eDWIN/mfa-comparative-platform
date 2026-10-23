import * as auth from '../services/authService.js';
import { audit, reqMeta } from '../services/auditService.js';
import { verifyOtpCredential } from '../services/otpCredentialService.js';
import { sendOobCode, verifyOobCode } from '../services/oobService.js';
import { authenticationOptions, verifyAuthentication } from '../services/webauthnService.js';
import { HttpError } from '../middleware/errors.js';
import { env } from '../config/env.js';
import { User } from '../models/index.js';

function startSession(res, user) {
  res.cookie(auth.SESSION_COOKIE, auth.issueSessionToken(user), auth.cookieOptions(env.JWT_TTL_SECONDS));
  res.clearCookie(auth.MFA_COOKIE, { path: '/' });
}

export async function register(req, res) {
  const user = await auth.register(req.body, reqMeta(req));
  startSession(res, user);
  res.status(201).json({ user: user.toSafeJSON() });
}

export async function login(req, res) {
  const { user, mfa } = await auth.login(req.body, reqMeta(req));
  if (mfa) {
    res.cookie(auth.MFA_COOKIE, auth.issueMfaToken(user, mfa), auth.cookieOptions(300));
    return res.json({ mfaRequired: true, method: mfa.method });
  }
  startSession(res, user);
  res.json({ user: user.toSafeJSON() });
}

/** Resolve the pending second-factor state from the short-lived mfa cookie. */
async function pending(req) {
  const claims = auth.verifyMfaToken(req.cookies?.[auth.MFA_COOKIE]);
  if (!claims) throw new HttpError(401, 'Second-factor session expired; sign in again', 'MFA_EXPIRED');
  const user = await User.findById(claims.sub);
  if (!user || user.status !== 'active') throw new HttpError(401, 'Account unavailable', 'MFA_EXPIRED');
  return { user, safe: user.toSafeJSON(), claims };
}

export async function mfaSendOob(req, res) {
  const { safe, claims } = await pending(req);
  if (claims.method !== 'OOB Email') throw new HttpError(400, 'Login factor is not email', 'WRONG_METHOD');
  res.json(await sendOobCode(safe, 'login'));
}

export async function mfaWebAuthnOptions(req, res) {
  const { safe, claims } = await pending(req);
  if (claims.method !== 'WebAuthn') throw new HttpError(400, 'Login factor is not WebAuthn', 'WRONG_METHOD');
  res.json(await authenticationOptions(safe, 'login'));
}

export async function mfaVerify(req, res) {
  const { user, safe, claims } = await pending(req);
  let r;
  if (claims.method === 'HOTP' || claims.method === 'TOTP') {
    if (!req.body.code) throw new HttpError(400, 'Code required', 'VALIDATION_ERROR');
    r = await verifyOtpCredential(safe, claims.cid, req.body.code, 'login');
  } else if (claims.method === 'OOB Email') {
    if (!req.body.code || !req.body.challengeId) throw new HttpError(400, 'Code and challengeId required', 'VALIDATION_ERROR');
    r = await verifyOobCode(safe, req.body.challengeId, req.body.code, 'login');
  } else {
    r = await verifyAuthentication(safe, req.body.response, 'login');
  }
  if (!r.ok) {
    await audit(user._id, 'auth.mfa_failed', { method: claims.method, reason: r.reason, ...reqMeta(req) });
    throw new HttpError(401, `Second factor rejected (${r.reason})`, 'MFA_FAILED');
  }
  await audit(user._id, 'auth.login_succeeded', { method: `password+${claims.method}`, ...reqMeta(req) });
  startSession(res, user);
  res.json({ user: safe });
}

export async function logout(req, res) {
  if (req.user) await audit(req.user.id, 'auth.logout', reqMeta(req));
  res.clearCookie(auth.SESSION_COOKIE, { path: '/' });
  res.clearCookie(auth.MFA_COOKIE, { path: '/' });
  res.status(204).end();
}

export function me(req, res) {
  res.json({ user: req.user });
}
