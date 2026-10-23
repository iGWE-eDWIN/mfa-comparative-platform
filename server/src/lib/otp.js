import crypto from 'node:crypto';
import { safeEqual } from './crypto.js';

/** Map of RFC 6238 algorithm names to Node digest names. */
export const OTP_ALGORITHMS = { SHA1: 'sha1', SHA256: 'sha256', SHA512: 'sha512' };

/**
 * HOTP(K, C) = Truncate(HMAC-SHA-1(K, C)) — RFC 4226 §5.3.
 * @param {Buffer} secret
 * @param {number|bigint} counter
 * @param {{ digits?: number, algorithm?: keyof typeof OTP_ALGORITHMS }} [opts]
 * @returns {string}
 */
export function hotp(secret, counter, { digits = 6, algorithm = 'SHA1' } = {}) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac(OTP_ALGORITHMS[algorithm], secret).update(msg).digest();
  // Dynamic truncation: low 4 bits of the last byte select a 4-byte window.
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * Verify an HOTP value against counters [counter, counter + lookAheadWindow].
 * Every candidate is compared in constant time and the loop never exits early on a match,
 * so timing does not reveal which counter matched.
 * @returns {{ ok: boolean, matchedCounter: number|null, drift: number|null }}
 */
export function verifyHotp(
  secret,
  code,
  counter,
  { lookAheadWindow = 10, digits = 6, algorithm = 'SHA1' } = {},
) {
  let matched = null;
  for (let i = 0; i <= lookAheadWindow; i++) {
    const candidate = hotp(secret, counter + i, { digits, algorithm });
    if (safeEqual(candidate, code) && matched === null) matched = counter + i;
  }
  return {
    ok: matched !== null,
    matchedCounter: matched,
    drift: matched === null ? null : matched - counter,
  };
}

/** T = floor((unixTime - T0) / X) — RFC 6238 §4.2. */
export function timeStep(unixSeconds, step = 30, t0 = 0) {
  return Math.floor((unixSeconds - t0) / step);
}

/** TOTP value for a given Unix time in seconds. */
export function totp(
  secret,
  unixSeconds,
  { step = 30, digits = 6, algorithm = 'SHA1', t0 = 0 } = {},
) {
  return hotp(secret, timeStep(unixSeconds, step, t0), { digits, algorithm });
}

/**
 * Verify TOTP within ±window steps. If `lastUsedStep` is given, any step <= lastUsedStep is
 * rejected (RFC 6238 §5.2: a verifier must not accept the same OTP twice).
 * @returns {{ ok: boolean, matchedStep: number|null, drift: number|null, replay: boolean }}
 */
export function verifyTotp(
  secret,
  code,
  unixSeconds,
  { step = 30, window = 1, digits = 6, algorithm = 'SHA1', t0 = 0, lastUsedStep = null } = {},
) {
  const current = timeStep(unixSeconds, step, t0);
  let matched = null;
  for (let d = -window; d <= window; d++) {
    const candidate = hotp(secret, current + d, { digits, algorithm });
    if (safeEqual(candidate, code) && matched === null) matched = current + d;
  }
  if (matched === null) return { ok: false, matchedStep: null, drift: null, replay: false };
  if (lastUsedStep !== null && matched <= lastUsedStep) {
    return { ok: false, matchedStep: matched, drift: matched - current, replay: true };
  }
  return { ok: true, matchedStep: matched, drift: matched - current, replay: false };
}

/** Build an otpauth:// key URI for QR enrolment (Google Authenticator key-URI format). */
export function otpauthUri({
  type,
  label,
  issuer,
  secretBase32,
  algorithm,
  digits,
  counter,
  period,
}) {
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm,
    digits: String(digits),
  });
  if (type === 'hotp') params.set('counter', String(counter ?? 0));
  if (type === 'totp') params.set('period', String(period ?? 30));
  return `otpauth://${type}/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?${params}`;
}
