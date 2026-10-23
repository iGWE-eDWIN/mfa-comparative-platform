import { describe, expect, it } from 'vitest';
import { hotp, totp, verifyHotp, verifyTotp, timeStep, otpauthUri } from '../../src/lib/otp.js';
import { base32Decode, base32Encode } from '../../src/lib/base32.js';

const SECRET = Buffer.from('12345678901234567890');

describe('HOTP — RFC 4226 Appendix D test vectors', () => {
  const expected = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ];
  it.each(expected.map((v, i) => [i, v]))('counter %i → %s', (counter, value) => {
    expect(hotp(SECRET, counter)).toBe(value);
  });
});

describe('TOTP — RFC 6238 Appendix B test vectors (8 digits)', () => {
  const keys = {
    SHA1: Buffer.from('12345678901234567890'),
    SHA256: Buffer.from('12345678901234567890123456789012'),
    SHA512: Buffer.from('1234567890123456789012345678901234567890123456789012345678901234'),
  };
  const table = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ];
  for (const [t, s1, s256, s512] of table) {
    it(`T=${t}`, () => {
      expect(totp(keys.SHA1, t, { digits: 8, algorithm: 'SHA1' })).toBe(s1);
      expect(totp(keys.SHA256, t, { digits: 8, algorithm: 'SHA256' })).toBe(s256);
      expect(totp(keys.SHA512, t, { digits: 8, algorithm: 'SHA512' })).toBe(s512);
    });
  }
  it('time step boundaries', () => {
    expect(timeStep(59)).toBe(1);
    expect(timeStep(60)).toBe(2);
    expect(timeStep(1111111109)).toBe(37037036);
  });
});

describe('verifyHotp look-ahead window', () => {
  it('accepts inside the window and reports drift', () => {
    expect(verifyHotp(SECRET, hotp(SECRET, 7), 2, { lookAheadWindow: 10 })).toEqual({
      ok: true,
      matchedCounter: 7,
      drift: 5,
    });
  });
  it('rejects beyond the window and behind the counter', () => {
    expect(verifyHotp(SECRET, hotp(SECRET, 13), 2, { lookAheadWindow: 10 }).ok).toBe(false);
    expect(verifyHotp(SECRET, hotp(SECRET, 1), 2, { lookAheadWindow: 10 }).ok).toBe(false);
  });
  it('window 0 accepts only the exact counter', () => {
    expect(verifyHotp(SECRET, hotp(SECRET, 3), 3, { lookAheadWindow: 0 }).ok).toBe(true);
    expect(verifyHotp(SECRET, hotp(SECRET, 4), 3, { lookAheadWindow: 0 }).ok).toBe(false);
  });
});

describe('verifyTotp window and replay', () => {
  const now = 1_700_000_000;
  it('accepts ±window steps and rejects beyond', () => {
    expect(verifyTotp(SECRET, totp(SECRET, now - 30), now, { window: 1 }).drift).toBe(-1);
    expect(verifyTotp(SECRET, totp(SECRET, now + 30), now, { window: 1 }).drift).toBe(1);
    expect(verifyTotp(SECRET, totp(SECRET, now + 60), now, { window: 1 }).ok).toBe(false);
  });
  it('rejects a step not newer than lastUsedStep (RFC 6238 §5.2)', () => {
    const code = totp(SECRET, now);
    const first = verifyTotp(SECRET, code, now, { lastUsedStep: null });
    expect(first.ok).toBe(true);
    const second = verifyTotp(SECRET, code, now, { lastUsedStep: first.matchedStep });
    expect(second).toMatchObject({ ok: false, replay: true });
  });
  it('rejects wrong codes and different lengths', () => {
    expect(verifyTotp(SECRET, '000000', now).ok).toBe(totp(SECRET, now) === '000000');
    expect(verifyTotp(SECRET, '12345', now).ok).toBe(false);
  });
});

describe('base32 and otpauth URI', () => {
  it('round-trips and matches RFC 4648 vectors', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    const b = Buffer.from([0, 1, 2, 250, 255]);
    expect(base32Decode(base32Encode(b))).toEqual(b);
    expect(() => base32Decode('M1')).toThrow();
  });
  it('builds hotp and totp URIs', () => {
    const t = otpauthUri({
      type: 'totp',
      label: 'alice',
      issuer: 'MFA Platform',
      secretBase32: 'ABC',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
    expect(t).toMatch(/^otpauth:\/\/totp\/MFA%20Platform:alice\?/);
    expect(t).toContain('period=30');
    expect(
      otpauthUri({
        type: 'hotp',
        label: 'a',
        issuer: 'I',
        secretBase32: 'ABC',
        algorithm: 'SHA1',
        digits: 6,
        counter: 4,
      }),
    ).toContain('counter=4');
  });
});
