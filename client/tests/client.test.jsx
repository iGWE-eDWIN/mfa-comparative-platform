import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { validateRegistration } from '../src/pages/Register.jsx';
import { hotp, totp, base32Decode } from '../src/lib/virtualToken.js';
import { Outcome, JobStatus } from '../src/components/ui.jsx';
import { ms, pct } from '../src/lib/format.js';
import { qs } from '../src/lib/api.js';

// "12345678901234567890" in base32
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('virtual token (WebCrypto) matches RFC 4226 / RFC 6238', () => {
  it('HOTP vectors', async () => {
    const expected = ['755224', '287082', '359152', '969429', '338314'];
    for (let i = 0; i < expected.length; i++) expect(await hotp(RFC_SECRET, i)).toBe(expected[i]);
  });
  it('TOTP vector T=59 (8 digits, SHA-1)', async () => {
    expect(await totp(RFC_SECRET, { digits: 8, at: 59_000 })).toBe('94287082');
  });
  it('rejects invalid base32', () => {
    expect(() => base32Decode('0189')).toThrow();
  });
});

describe('registration validation mirrors the server', () => {
  it('flags every invalid field', () => {
    expect(
      Object.keys(
        validateRegistration({
          username: 'a',
          email: 'x',
          password: 'short',
          confirmPassword: 'y',
        }),
      ),
    ).toEqual(['username', 'email', 'password', 'confirmPassword']);
    expect(
      validateRegistration({
        username: 'alice',
        email: 'a@b.co',
        password: 'long-enough',
        confirmPassword: 'long-enough',
      }),
    ).toEqual({});
  });
});

describe('status badges never rely on colour alone', () => {
  it('outcomes carry an icon and a label', () => {
    render(
      <>
        <Outcome status="pass" />
        <Outcome status="fail" />
        <Outcome status="not-applicable" />
        <JobStatus status="Failed" />
      </>,
    );
    expect(screen.getByText('✓ Pass')).toBeInTheDocument();
    expect(screen.getByText('✕ Fail')).toBeInTheDocument();
    expect(screen.getByText('– N/A')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });
});

describe('formatting helpers', () => {
  it('formats durations, percentages and query strings', () => {
    expect(ms(0.004321)).toBe('0.00432 ms');
    expect(ms(12.3456)).toBe('12.346 ms');
    expect(ms(null)).toBe('—');
    expect(pct(0.0123)).toBe('1.23%');
    expect(qs({ a: 1, b: '', c: undefined, d: 'x y' })).toBe('?a=1&d=x+y');
  });
});
