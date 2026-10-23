import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createModule } from '../../src/protocols/ProtocolManager.js';
import { launchBrowser } from '../../src/lib/virtualAuthenticator.js';
import { runSecuritySimulations } from '../../src/services/securitySimulationService.js';
import { runBenchmark } from '../../src/services/benchmark/runner.js';
import { keys } from '../../src/services/keys.js';

let browser;
const rp = { id: 'localhost', name: 'E2E', origin: 'http://localhost:5173' };
const makeCtx = (clock = { offsetMs: 0 }) => ({
  now: () => Date.now() + clock.offsetMs,
  keys,
  getBrowser: async () => browser,
  rp,
});

beforeAll(async () => {
  browser = await launchBrowser();
});
afterAll(async () => browser?.close());

describe('WebAuthn module with CDP virtual authenticator', () => {
  it('registers and authenticates through a real browser ceremony', async () => {
    const m = createModule('WebAuthn', makeCtx(), {});
    const { enrolmentNs } = await m.initialize();
    expect(enrolmentNs).toBeGreaterThan(0n);
    const tx = await m.execute();
    expect(tx.artifact.response.type).toBe('public-key');
    expect(tx.meta.ceremonyNs).toBeGreaterThan(0n);
    const v = await m.verify(tx);
    expect(v).toMatchObject({ ok: true, meta: { userVerified: true } });
    expect((await m.verify(tx)).reason).toBe('unknown_or_used_challenge');
    expect(m.collectMetrics()).toMatchObject({
      attestationFormat: 'none',
      lastSignCount: expect.any(Number),
    });
    expect((await m.session.credentials()).length).toBe(1);
    await m.reset();
  });
  it('supports RS256 and required user verification', async () => {
    const m = createModule('WebAuthn', makeCtx(), {
      algorithm: -257,
      userVerification: 'required',
    });
    await m.initialize();
    expect((await m.verify(await m.execute())).ok).toBe(true);
    await m.reset();
  });
  it('security simulations: origin binding, replay, forged signatures, expiry', async () => {
    const s = await runSecuritySimulations(
      'WebAuthn',
      createModule('WebAuthn', makeCtx()).config,
      makeCtx,
    );
    expect(s.phishingTest.status).toBe('pass');
    expect(s.phishingTest.evidence.lookalikeOrigin).toMatchObject({
      accepted: false,
      rejectedBy: 'browser',
    });
    expect(s.phishingTest.evidence.sameHostDifferentOrigin).toMatchObject({
      accepted: false,
      rejectedBy: 'server',
    });
    expect(s.replayTest.status).toBe('pass');
    expect(s.bruteForceTest).toMatchObject({
      status: 'pass',
      evidence: { forgedAccepted: 0, genuineAcceptedAfter: true },
    });
    expect(s.expiredCodeTest.status).toBe('pass');
    expect(s.desynchronisationObservation.status).toBe('not-applicable');
  });
  it('benchmark runner reports server verification separately from the ceremony', async () => {
    const { results } = await runBenchmark({
      protocols: [{ name: 'WebAuthn', config: {} }],
      settings: {
        iterations: 10,
        warmupIterations: 2,
        timeoutMs: 60000,
        operationTimeoutMs: 10000,
        runSecuritySimulations: false,
      },
      makeCtx,
    });
    const r = results[0];
    expect(r.status).toBe('Completed');
    expect(r.metrics.errorRate).toBe(0);
    expect(r.metrics.serverVerifyTime.n).toBe(10);
    expect(r.metrics.channel.ceremonyTime.mean).toBeGreaterThan(r.metrics.serverVerifyTime.mean);
    expect(r.metrics.latency.mean).toBeGreaterThan(r.metrics.processingTime.mean);
  });
});
