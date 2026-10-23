import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decrypt,
  encrypt,
  hashCode,
  newSalt,
  parseKey,
  randomNumericCode,
  safeEqual,
} from '../../src/lib/crypto.js';

const key = crypto.randomBytes(32);

describe('AES-256-GCM secret storage', () => {
  it('round-trips and never stores plaintext', () => {
    const secret = Buffer.from('super-secret-otp-key');
    const env = encrypt(secret, key, 'HOTP:1');
    expect(JSON.stringify(env)).not.toContain('super-secret');
    expect(decrypt(env, key, 'HOTP:1')).toEqual(secret);
  });
  it('detects tampering, wrong key and wrong AAD', () => {
    const env = encrypt(Buffer.from('x'.repeat(20)), key, 'A');
    const tampered = {
      ...env,
      data: Buffer.from(
        Buffer.from(env.data, 'base64').map((b, i) => (i === 0 ? b ^ 1 : b)),
      ).toString('base64'),
    };
    expect(() => decrypt(tampered, key, 'A')).toThrow();
    expect(() => decrypt(env, crypto.randomBytes(32), 'A')).toThrow();
    expect(() => decrypt(env, key, 'B')).toThrow();
  });
  it('uses a fresh IV each time', () => {
    const a = encrypt(Buffer.from('same'), key);
    const b = encrypt(Buffer.from('same'), key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });
  it('parses hex and base64 keys and rejects bad lengths', () => {
    expect(parseKey('ab'.repeat(32))).toHaveLength(32);
    expect(parseKey(crypto.randomBytes(32).toString('base64'))).toHaveLength(32);
    expect(() => parseKey('abcd')).toThrow(/32 bytes/);
  });
});

describe('OOB code hashing and comparison', () => {
  it('HMAC depends on code, salt and pepper', () => {
    const salt = newSalt();
    const h = hashCode('123456', salt, 'pepper');
    expect(hashCode('123456', salt, 'pepper')).toBe(h);
    expect(hashCode('123457', salt, 'pepper')).not.toBe(h);
    expect(hashCode('123456', newSalt(), 'pepper')).not.toBe(h);
    expect(hashCode('123456', salt, 'other')).not.toBe(h);
  });
  it('safeEqual handles equal, unequal and different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
  it('random codes are fixed-length digits covering the range', () => {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      const c = randomNumericCode(6);
      expect(c).toMatch(/^\d{6}$/);
      seen.add(c[0]);
    }
    expect(seen.size).toBe(10);
    expect(randomNumericCode(8)).toMatch(/^\d{8}$/);
  });
});
