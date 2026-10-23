import { describe, expect, it } from 'vitest';
import {
  createModule,
  defaultParameters,
  protocolNames,
  validateParams,
  getModuleClass,
} from '../../src/protocols/ProtocolManager.js';
import { fakeMailer, makeCtx } from '../helpers/fakes.js';

const INTERFACE = ['configure', 'initialize', 'execute', 'verify', 'collectMetrics', 'reset'];

describe('ProtocolManager and common interface (§3.7.5)', () => {
  it('registers exactly the four protocols', () => {
    expect(protocolNames()).toEqual(['HOTP', 'TOTP', 'OOB Email', 'WebAuthn']);
  });
  it.each(['HOTP', 'TOTP', 'OOB Email', 'WebAuthn'])('%s implements the six operations', (name) => {
    const m = createModule(name, makeCtx());
    for (const op of INTERFACE) expect(typeof m[op]).toBe('function');
  });
  it('rejects unknown protocols and invalid parameters', () => {
    expect(() => getModuleClass('SMS')).toThrow(/Unknown protocol/);
    expect(() => validateParams('HOTP', { digits: 4 })).toThrow();
    expect(() => validateParams('TOTP', { timeStep: 1 })).toThrow();
    expect(() => validateParams('WebAuthn', { algorithm: 5 })).toThrow();
    expect(() => validateParams('OOB Email', { recipient: 'not-an-email' })).toThrow();
  });
  it('coerces string booleans correctly ("false" stays false)', () => {
    expect(validateParams('TOTP', { preventReuse: 'false' }).preventReuse).toBe(false);
    expect(validateParams('OOB Email', { sendEmail: 'true' }).sendEmail).toBe(true);
  });
  it('produces defaultConfig.parameters[] {name,value,type}', () => {
    const p = defaultParameters('HOTP');
    expect(p).toContainEqual({ name: 'lookAheadWindow', value: 10, type: 'number' });
    expect(p).toContainEqual({ name: 'algorithm', value: 'SHA1', type: 'string' });
  });
});

describe('HOTP module', () => {
  it('authenticates, advances the counter and rejects replay', async () => {
    const m = createModule('HOTP', makeCtx());
    await m.initialize();
    const tx = await m.execute();
    expect((await m.verify(tx)).ok).toBe(true);
    expect((await m.verify(tx)).ok).toBe(false);
    expect(m.collectMetrics()).toMatchObject({ serverCounter: 1, tokenCounter: 1 });
  });
  it('resynchronises within the window, rejects beyond, and locks after maxAttempts', async () => {
    const m = createModule('HOTP', makeCtx(), { lookAheadWindow: 3, maxAttempts: 2 });
    await m.initialize();
    const r = await m.verify(await m.execute({ counterDrift: 3 }));
    expect(r).toMatchObject({ ok: true, meta: { drift: 3 } });
    expect(m.collectMetrics().resyncCount).toBe(1);
    expect((await m.verify(await m.execute({ counterDrift: 4 }))).ok).toBe(false);
    await m.verify({ artifact: { code: '000000' } });
    expect((await m.verify({ artifact: { code: '000000' } })).reason).toBe('locked');
    m.unlock();
    m.setTokenCounter(m.collectMetrics().serverCounter);
    expect((await m.verify(await m.execute())).ok).toBe(true);
    await m.reset();
  });
  it('supports SHA-256/8 digits', async () => {
    const m = createModule('HOTP', makeCtx(), { algorithm: 'SHA256', digits: 8 });
    await m.initialize();
    const tx = await m.execute();
    expect(tx.artifact.code).toMatch(/^\d{8}$/);
    expect((await m.verify(tx)).ok).toBe(true);
  });
});

describe('TOTP module', () => {
  it('each iteration is a fresh step with the simulated clock', async () => {
    const m = createModule('TOTP', makeCtx());
    await m.initialize();
    for (let i = 0; i < 5; i++) expect((await m.verify(await m.execute())).ok).toBe(true);
    expect(m.collectMetrics().acceptedDriftSteps).toEqual({ 0: 5 });
  });
  it('rejects replay with preventReuse and accepts it without', async () => {
    const m = createModule('TOTP', makeCtx());
    await m.initialize();
    const tx = await m.execute();
    await m.verify(tx);
    expect((await m.verify(tx)).reason).toBe('replayed_code');
    const bare = createModule('TOTP', makeCtx(), { preventReuse: false });
    await bare.initialize();
    const t2 = await bare.execute();
    expect((await bare.verify(t2)).ok).toBe(true);
    expect((await bare.verify(t2)).ok).toBe(true);
  });
  it('tolerates ±window clock skew and rejects larger skew', async () => {
    const attempt = async (skew) => {
      const m = createModule('TOTP', makeCtx(), { window: 1 });
      await m.initialize();
      return m.verify(await m.execute({ clockSkewSeconds: skew }));
    };
    expect((await attempt(30)).meta.driftSteps).toBe(1);
    expect((await attempt(-30)).meta.driftSteps).toBe(-1);
    expect((await attempt(61)).ok).toBe(false);
    expect((await attempt(-61)).ok).toBe(false);
  });
  it('an older step is refused after a newer one was accepted', async () => {
    const m = createModule('TOTP', makeCtx(), { window: 1, advanceClockPerIteration: false });
    await m.initialize();
    expect((await m.verify(await m.execute({ clockSkewSeconds: 30 }))).ok).toBe(true);
    expect((await m.verify(await m.execute({ clockSkewSeconds: 0 }))).reason).toBe('replayed_code');
  });
  it('expires codes when the clock moves on, and locks after failures', async () => {
    const m = createModule('TOTP', makeCtx(), { maxAttempts: 1, advanceClockPerIteration: false });
    await m.initialize();
    const tx = await m.execute();
    m.advanceClock(120);
    expect((await m.verify(tx)).ok).toBe(false);
    expect((await m.verify(tx)).reason).toBe('locked');
    m.unlock();
    expect((await m.verify(await m.execute())).ok).toBe(true);
    await m.reset();
  });
});

describe('OOB Email module', () => {
  it('sends the code by email and verifies once', async () => {
    const mailer = fakeMailer();
    const m = createModule('OOB Email', makeCtx({ mailer }));
    await m.initialize();
    const tx = await m.execute();
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].code).toBe(tx.artifact.code);
    expect(tx.meta.sendNs).toBeGreaterThan(0n);
    expect((await m.verify(tx)).ok).toBe(true);
    expect((await m.verify(tx)).reason).toBe('already_used');
    expect(m.collectMetrics()).toMatchObject({ provider: 'fake', delivered: 1, reuseRejected: 1 });
  });
  it('never stores the plaintext code', async () => {
    const m = createModule('OOB Email', makeCtx());
    await m.initialize();
    const tx = await m.execute();
    const stored = JSON.stringify([...m.challenges.values()]);
    expect(stored).not.toContain(`"${tx.artifact.code}"`);
    expect(stored).toContain('codeHash');
  });
  it('enforces expiry, attempt limit, cooldown and unknown challenges', async () => {
    const ctx = makeCtx();
    const m = createModule('OOB Email', ctx, {
      maxAttempts: 2,
      expirySeconds: 60,
      resendCooldownSeconds: 30,
    });
    await m.initialize();
    const tx = await m.execute();
    await m.verify({
      artifact: { ...tx.artifact, code: '000000' === tx.artifact.code ? '111111' : '000000' },
    });
    await m.verify({
      artifact: { ...tx.artifact, code: '000000' === tx.artifact.code ? '111111' : '000000' },
    });
    expect((await m.verify(tx)).reason).toBe('attempts_exceeded');
    const tx2 = await m.execute();
    expect((await m.resend(tx2.artifact.challengeId)).reason).toBe('resend_cooldown');
    ctx.clock.offsetMs = 31_000;
    const resent = await m.resend(tx2.artifact.challengeId);
    expect(resent.ok).toBe(true);
    expect((await m.verify(tx2)).reason).toBe('unknown_challenge');
    ctx.clock.offsetMs = 100_000;
    expect((await m.verify(resent.tx)).reason).toBe('expired');
    expect((await m.resend('nope')).reason).toBe('unknown_challenge');
  });
  it('reports delivery failure as an error and supports sendEmail=false', async () => {
    const m = createModule('OOB Email', makeCtx({ mailer: fakeMailer({ fail: true }) }));
    await m.initialize();
    await expect(m.execute()).rejects.toMatchObject({ code: 'DELIVERY_FAILED' });
    expect(m.collectMetrics().deliveryFailures).toBe(1);
    const offline = createModule('OOB Email', makeCtx({ mailer: null }), { sendEmail: false });
    await offline.initialize();
    expect((await offline.verify(await offline.execute())).ok).toBe(true);
    const noMailer = createModule('OOB Email', makeCtx({ mailer: null }));
    await expect(noMailer.initialize()).rejects.toThrow(/mailer/);
  });
});
