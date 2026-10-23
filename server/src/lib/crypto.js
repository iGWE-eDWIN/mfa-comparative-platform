import crypto from 'node:crypto';

/**
 * Parse a 32-byte key supplied as 64 hex characters or base64.
 * @param {string} raw
 * @returns {Buffer}
 */
export function parseKey(raw) {
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== 32)
    throw new Error('Encryption key must be 32 bytes (64 hex chars or base64)');
  return buf;
}

/**
 * AES-256-GCM encryption of protocol secrets at rest (Chapter 3 §3.11).
 * @param {Buffer} plaintext
 * @param {Buffer} key
 * @param {string} [aad] additional authenticated data, e.g. the owning credential's purpose
 * @returns {{ v: 1, iv: string, tag: string, data: string }}
 */
export function encrypt(plaintext, key, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

/**
 * @param {{ iv: string, tag: string, data: string }} envelope
 * @param {Buffer} key
 * @param {string} [aad]
 * @returns {Buffer}
 */
export function decrypt(envelope, key, aad) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
}

/**
 * HMAC-SHA-256 of a one-time code with a server pepper and a per-record salt (OOB storage).
 * @param {string} code
 * @param {string} salt base64
 * @param {string|Buffer} pepper
 */
export function hashCode(code, salt, pepper) {
  return crypto
    .createHmac('sha256', pepper)
    .update(Buffer.from(salt, 'base64'))
    .update(code)
    .digest('base64');
}

export function newSalt() {
  return crypto.randomBytes(16).toString('base64');
}

/**
 * Constant-time string comparison. Inputs of different length are compared against a
 * same-length dummy so the comparison time does not reveal the expected length.
 * @param {string} a
 * @param {string} b
 */
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/** Cryptographically random numeric code of `digits` length (crypto.randomInt). */
export function randomNumericCode(digits = 6) {
  return String(crypto.randomInt(0, 10 ** digits)).padStart(digits, '0');
}
