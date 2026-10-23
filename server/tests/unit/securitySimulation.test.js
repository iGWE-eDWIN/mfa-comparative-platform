import { describe, expect, it } from 'vitest';
import { runSecuritySimulations } from '../../src/services/securitySimulationService.js';
import { validateParams } from '../../src/protocols/ProtocolManager.js';
import { fakeMailer, makeCtx } from '../helpers/fakes.js';

const run = (name, params = {}) =>
  runSecuritySimulations(name, validateParams(name, params), (clock) =>
    makeCtx({ mailer: fakeMailer(), clock }),
  );

describe('Security Simulation Service', () => {
  it('HOTP outcomes', async () => {
    const s = await run('HOTP');
    expect(s.phishingTest.status).toBe('fail');
    expect(s.replayTest.status).toBe('pass');
    expect(s.bruteForceTest).toMatchObject({
      status: 'pass',
      evidence: { maxAttempts: 5, correctCodeAcceptedAfterLimit: false },
    });
    expect(s.expiredCodeTest).toMatchObject({
      status: 'not-applicable',
      evidence: { acceptedAfter24h: true },
    });
    expect(s.desynchronisationObservation).toMatchObject({
      status: 'pass',
      evidence: { driftInsideWindow: { accepted: true }, driftOutsideWindow: { accepted: false } },
    });
    expect(s.securityNotes.join(' ')).toMatch(/not penetration testing/);
  });
  it('TOTP outcomes include the bare-algorithm replay evidence', async () => {
    const s = await run('TOTP');
    expect(s.phishingTest.status).toBe('fail');
    expect(s.replayTest).toMatchObject({
      status: 'pass',
      evidence: { replayAccepted: false, withoutStepTracking: { replayAccepted: true } },
    });
    expect(s.expiredCodeTest.status).toBe('pass');
    expect(s.desynchronisationObservation.evidence.acceptedBySkew).toEqual({
      '-30s': true,
      '30s': true,
      '60s': false,
      '-60s': false,
    });
    expect(s.bruteForceTest.evidence.acceptableValuesPerAttempt).toBe(3);
  });
  it('OOB Email outcomes', async () => {
    const s = await run('OOB Email');
    expect(s.phishingTest.status).toBe('fail');
    expect(s.replayTest.status).toBe('pass');
    expect(s.bruteForceTest.status).toBe('pass');
    expect(s.expiredCodeTest).toMatchObject({ status: 'pass', evidence: { reason: 'expired' } });
    expect(s.desynchronisationObservation.status).toBe('not-applicable');
  });
  it('a scenario that throws is reported as error, not a crash', async () => {
    const s = await runSecuritySimulations('OOB Email', validateParams('OOB Email', {}), (clock) =>
      makeCtx({ mailer: fakeMailer({ fail: true }), clock }),
    );
    expect(s.replayTest.status).toBe('error');
    expect(s.replayTest.explanation).toMatch(/could not run/);
  });
});
