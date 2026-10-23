import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { Credential } from '../models/index.js';
import { keys } from './keys.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { base32Encode } from '../lib/base32.js';
import { verifyHotp, verifyTotp, otpauthUri } from '../lib/otp.js';
import { validateParams } from '../protocols/ProtocolManager.js';
import { SECRET_BYTES } from '../protocols/hotp/index.js';
import { HttpError } from '../middleware/errors.js';
import { audit } from './auditService.js';

const LOCK_MS = 15 * 60 * 1000;
const aad = (protocol, userId) => `${protocol}:${userId}`;

/**
 * Enrol an HOTP or TOTP credential. The plaintext secret leaves the server exactly once,
 * in this response, because the user's authenticator needs it (QR / otpauth URI).
 */
export async function enrolOtp(user, protocol, params = {}) {
  const cfg = validateParams(protocol, params);
  const secret = crypto.randomBytes(SECRET_BYTES[cfg.algorithm]);
  const cred = await Credential.create({
    userId: user.id,
    protocol,
    label: `${protocol} (${cfg.algorithm}, ${cfg.digits} digits)`,
    status: 'pending',
    encryptedSecret: encrypt(secret, keys.encryptionKey, aad(protocol, user.id)),
    otp:
      protocol === 'HOTP'
        ? {
            algorithm: cfg.algorithm,
            digits: cfg.digits,
            counter: 0,
            lookAheadWindow: cfg.lookAheadWindow,
          }
        : {
            algorithm: cfg.algorithm,
            digits: cfg.digits,
            timeStep: cfg.timeStep,
            window: cfg.window,
            lastUsedStep: null,
          },
  });
  const secretBase32 = base32Encode(secret);
  const uri = otpauthUri({
    type: protocol.toLowerCase(),
    label: user.username,
    issuer: 'MFA Comparative Platform',
    secretBase32,
    algorithm: cfg.algorithm,
    digits: cfg.digits,
    counter: 0,
    period: cfg.timeStep,
  });
  await audit(user.id, 'credential.enrol_started', { protocol, credentialId: String(cred._id) });
  return {
    credentialId: String(cred._id),
    secretBase32,
    otpauthUri: uri,
    qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }),
    config: cred.otp,
  };
}

/**
 * Verify a code for a stored credential. Counter / last-step updates are conditional on the
 * values that were read, so two concurrent submissions of the same code cannot both succeed.
 * @returns {Promise<{ ok: boolean, reason?: string, serverTimeMs: number, drift?: number }>}
 */
export async function verifyOtpCredential(user, credentialId, code, purpose = 'simulator') {
  const cred = await Credential.findOne({
    _id: credentialId,
    userId: user.id,
    protocol: { $in: ['HOTP', 'TOTP'] },
  }).select('+encryptedSecret');
  if (!cred) throw new HttpError(404, 'Credential not found', 'NOT_FOUND');
  const start = process.hrtime.bigint();
  const ms = () => Number(process.hrtime.bigint() - start) / 1e6;
  if (cred.lockedUntil && cred.lockedUntil > new Date()) {
    await audit(user.id, 'credential.verify_locked', { protocol: cred.protocol, purpose });
    return { ok: false, reason: 'locked', serverTimeMs: ms(), lockedUntil: cred.lockedUntil };
  }
  const secret = decrypt(cred.encryptedSecret, keys.encryptionKey, aad(cred.protocol, user.id));
  let ok = false;
  let reason = 'invalid_code';
  let drift;
  let update = null;
  let guard = {};
  if (cred.protocol === 'HOTP') {
    const r = verifyHotp(secret, String(code), cred.otp.counter, cred.otp);
    if (r.ok) {
      ok = true;
      drift = r.drift;
      guard = { 'otp.counter': cred.otp.counter };
      update = {
        $set: { 'otp.counter': r.matchedCounter + 1, failedAttempts: 0, lastUsedAt: new Date() },
        ...(r.drift > 0 && { $inc: { 'otp.resyncCount': 1 } }),
      };
    }
  } else {
    const r = verifyTotp(secret, String(code), Math.floor(Date.now() / 1000), {
      step: cred.otp.timeStep,
      window: cred.otp.window,
      digits: cred.otp.digits,
      algorithm: cred.otp.algorithm,
      lastUsedStep: cred.otp.lastUsedStep ?? null,
    });
    if (r.replay) reason = 'replayed_code';
    if (r.ok) {
      ok = true;
      drift = r.drift;
      guard = { 'otp.lastUsedStep': cred.otp.lastUsedStep ?? null };
      update = {
        $set: { 'otp.lastUsedStep': r.matchedStep, failedAttempts: 0, lastUsedAt: new Date() },
      };
    }
  }
  const serverTimeMs = ms();
  if (ok) {
    const won = await Credential.updateOne({ _id: cred._id, ...guard }, update);
    if (won.modifiedCount === 0) ok = false; // lost a race against a concurrent use of the same code
    if (ok && cred.status === 'pending')
      await Credential.updateOne({ _id: cred._id }, { $set: { status: 'active' } });
  }
  if (!ok) {
    const attempts = cred.failedAttempts + 1;
    const lock =
      attempts >= 5
        ? { lockedUntil: new Date(Date.now() + LOCK_MS), failedAttempts: 0 }
        : { failedAttempts: attempts };
    if (reason !== 'replayed_code') await Credential.updateOne({ _id: cred._id }, { $set: lock });
    await audit(user.id, 'credential.verify_failed', {
      protocol: cred.protocol,
      purpose,
      reason,
      locked: Boolean(lock.lockedUntil),
    });
    return { ok: false, reason, serverTimeMs };
  }
  await audit(user.id, 'credential.verify_succeeded', { protocol: cred.protocol, purpose, drift });
  return { ok: true, serverTimeMs, drift, activated: cred.status === 'pending' };
}
