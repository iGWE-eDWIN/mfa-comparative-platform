import crypto from 'node:crypto';
import { createModule } from '../protocols/ProtocolManager.js';

/**
 * Security Simulation Service (Chapter 3 §3.8.3). Controlled, reproducible scenarios run
 * against fresh module instances through the common interface. These are protocol-property
 * tests, NOT penetration testing (Chapter 1 §1.7).
 *
 * Every scenario returns { status: 'pass'|'fail'|'not-applicable'|'error', explanation, evidence }.
 * "pass" means the implementation resisted / behaved as the defence requires.
 */

const outcome = (status, explanation, evidence = {}) => ({ status, explanation, evidence });

/** Second origin on the same host: valid RP ID for "localhost", different origin (D18). */
function sameHostOtherOrigin(origin) {
  const u = new URL(origin);
  u.port = u.port === '6666' ? '6667' : '6666';
  return u.origin;
}

/**
 * @param {string} protocol
 * @param {object} config validated protocol parameters
 * @param {(clock: { offsetMs: number }) => import('../protocols/ProtocolModule.js').ModuleContext} makeCtx
 */
export async function runSecuritySimulations(protocol, config, makeCtx) {
  const fresh = async (overrides = {}) => {
    const clock = { offsetMs: 0 };
    const m = createModule(protocol, makeCtx(clock), { ...config, ...overrides });
    await m.initialize();
    return { m, clock };
  };
  const scenarios = { phishingTest: phishing, replayTest: replay, bruteForceTest: bruteForce, expiredCodeTest: expired, desynchronisationObservation: desync };
  const out = { securityNotes: [] };
  for (const [key, fn] of Object.entries(scenarios)) {
    let instance = null;
    try {
      out[key] = await fn(protocol, config, async (o) => (instance = await fresh(o)));
    } catch (err) {
      out[key] = outcome('error', `Scenario could not run: ${err.message}`);
    } finally {
      await instance?.m.reset().catch(() => {});
    }
  }
  out.securityNotes.push(
    'Controlled simulations of defined attack scenarios against this implementation; not penetration testing and not a discovery of unknown vulnerabilities.',
  );
  if (protocol === 'WebAuthn') out.securityNotes.push('Authenticator is a CDP software Virtual Authenticator; hardware key behaviour is outside scope.');
  if (protocol === 'OOB Email') out.securityNotes.push('Email-account compromise and SMTP-hop interception (Chapter 2 §2.4.3.2) are not simulated; real providers are forced to use TLS (requireTLS).');
  return out;
}

async function phishing(protocol, config, fresh) {
  const { m } = await fresh();
  if (protocol === 'WebAuthn') {
    const legit = await m.verify(await m.execute());
    const lookalike = await m.verify(await m.execute({ origin: 'https://phish.example' }));
    const otherOrigin = sameHostOtherOrigin(m.rp.origin);
    const sameHost = await m.verify(await m.execute({ origin: otherOrigin }));
    const resisted = legit.ok && !lookalike.ok && !sameHost.ok;
    return outcome(
      resisted ? 'pass' : 'fail',
      resisted
        ? `Origin binding held: the legitimate origin verified, the look-alike origin was refused by the browser (${lookalike.meta?.browserError?.code ?? lookalike.reason}), and the assertion produced on ${otherOrigin} was rejected by the server (${sameHost.reason}) because clientDataJSON.origin did not match the relying party.`
        : 'Origin binding did not behave as expected; see evidence.',
      {
        legitimateOrigin: { origin: m.rp.origin, accepted: legit.ok },
        lookalikeOrigin: { origin: 'https://phish.example', accepted: lookalike.ok, rejectedBy: lookalike.reason === 'ceremony_rejected' ? 'browser' : 'server', detail: lookalike.meta?.browserError ?? lookalike.meta },
        sameHostDifferentOrigin: { origin: otherOrigin, accepted: sameHost.ok, rejectedBy: sameHost.reason === 'ceremony_rejected' ? 'browser' : 'server', detail: sameHost.meta },
      },
    );
  }
  // Real-time relay (Evilginx-style): the victim types the code into the attacker's proxy,
  // which immediately submits it to the genuine server. Nothing in the code identifies the origin.
  const victimTx = await m.execute();
  const relayed = await m.verify({ ...victimTx, artifact: { ...victimTx.artifact } });
  return outcome(
    relayed.ok ? 'fail' : 'pass',
    relayed.ok
      ? 'Not phishing-resistant: a code captured by a simulated attacker proxy and relayed to the genuine server within its validity window was accepted, because the code carries no origin binding.'
      : `Relayed code was rejected (${relayed.reason}).`,
    { relayAccepted: relayed.ok, reason: relayed.reason ?? null },
  );
}

async function replay(protocol, config, fresh) {
  const { m } = await fresh();
  const tx = await m.execute();
  const first = await m.verify(tx);
  const second = await m.verify(tx);
  const evidence = { firstUseAccepted: first.ok, replayAccepted: second.ok, replayRejectionReason: second.reason ?? null };
  if (protocol === 'TOTP') {
    // Same scenario with step tracking disabled shows what the bare RFC 6238 algorithm allows.
    const { m: bare } = await fresh({ preventReuse: false });
    const t = await bare.execute();
    const a = await bare.verify(t);
    const b = await bare.verify(t);
    await bare.reset();
    evidence.withoutStepTracking = { firstUseAccepted: a.ok, replayAccepted: b.ok };
  }
  const resisted = first.ok && !second.ok;
  const why = {
    HOTP: 'the server advanced its counter past the matched value, so the same code no longer falls inside the look-ahead window',
    TOTP: 'the server records the last accepted time step (RFC 6238 §5.2) and refuses any step not newer than it',
    'OOB Email': 'the code was marked used on first successful verification',
    WebAuthn: 'the challenge was consumed on first use, so the signed assertion refers to a challenge the server no longer accepts',
  }[protocol];
  let explanation = resisted ? `Replay rejected: ${why}.` : 'Replay was accepted; see evidence.';
  if (protocol === 'TOTP' && evidence.withoutStepTracking.replayAccepted) {
    explanation += ' With step tracking disabled the identical code was accepted twice, so replay resistance comes from server state, not from the algorithm itself.';
  }
  return outcome(resisted ? 'pass' : 'fail', explanation, evidence);
}

async function bruteForce(protocol, config, fresh) {
  const { m } = await fresh();
  if (protocol === 'WebAuthn') {
    const attempts = 5;
    let accepted = 0;
    for (let i = 0; i < attempts; i++) {
      const tx = await m.execute();
      const forged = structuredClone(tx.artifact);
      forged.response.response.signature = crypto.randomBytes(72).toString('base64url');
      if ((await m.verify({ ...tx, artifact: forged })).ok) accepted++;
    }
    const genuine = await m.verify(await m.execute());
    return outcome(
      accepted === 0 && genuine.ok ? 'pass' : 'fail',
      `There is no shared code to guess. ${attempts} assertions with random signatures were all rejected by signature verification, and the genuine credential still authenticated afterwards.`,
      { forgedAttempts: attempts, forgedAccepted: accepted, genuineAcceptedAfter: genuine.ok },
    );
  }
  const digits = config.digits ?? config.codeDigits ?? 6;
  const maxAttempts = config.maxAttempts;
  const tx = await m.execute();
  const wrong = String((Number(tx.artifact.code) + 1) % 10 ** digits).padStart(digits, '0');
  let attemptsUntilBlocked = null;
  const reasons = [];
  for (let i = 1; i <= maxAttempts + 2; i++) {
    const r = await m.verify({ ...tx, artifact: { ...tx.artifact, code: wrong } });
    reasons.push(r.reason);
    if (attemptsUntilBlocked === null && ['locked', 'attempts_exceeded'].includes(r.reason)) attemptsUntilBlocked = i;
  }
  // After the limit, even the correct code must be refused.
  const correctAfter = await m.verify(tx);
  const candidates = protocol === 'HOTP' ? config.lookAheadWindow + 1 : protocol === 'TOTP' ? 2 * config.window + 1 : 1;
  const successProbability = Math.min(1, (maxAttempts * candidates) / 10 ** digits);
  const resisted = !correctAfter.ok && attemptsUntilBlocked !== null;
  return outcome(
    resisted ? 'pass' : 'fail',
    resisted
      ? `After ${maxAttempts} wrong guesses the ${protocol === 'OOB Email' ? 'challenge was invalidated' : 'credential was locked'}, and the correct code was refused afterwards. An online guesser has at most ${maxAttempts} tries × ${candidates} acceptable value(s) out of 10^${digits}, a success probability of about ${successProbability.toExponential(2)} per lockout period.`
      : 'Guessing was not limited as configured; see evidence.',
    { maxAttempts, attemptsUntilBlocked, rejectionReasons: reasons, correctCodeAcceptedAfterLimit: correctAfter.ok, acceptableValuesPerAttempt: candidates, successProbability },
  );
}

async function expired(protocol, config, fresh) {
  const { m, clock } = await fresh();
  if (protocol === 'OOB Email') {
    const tx = await m.execute();
    clock.offsetMs = (config.expirySeconds + 1) * 1000;
    const r = await m.verify(tx);
    return outcome(
      r.ok ? 'fail' : 'pass',
      r.ok ? 'An expired code was accepted.' : `A code submitted ${config.expirySeconds + 1} s after issue (expiry ${config.expirySeconds} s) was rejected (${r.reason}).`,
      { expirySeconds: config.expirySeconds, submittedAfterSeconds: config.expirySeconds + 1, accepted: r.ok, reason: r.reason ?? null },
    );
  }
  if (protocol === 'TOTP') {
    const tx = await m.execute();
    const lateBy = (config.window + 1) * config.timeStep + 1;
    m.advanceClock(lateBy);
    const r = await m.verify(tx);
    return outcome(
      r.ok ? 'fail' : 'pass',
      r.ok ? 'A stale TOTP code was accepted.' : `A code used ${lateBy} s after generation (beyond ±${config.window} step(s) of ${config.timeStep} s) was rejected.`,
      { lateBySeconds: lateBy, accepted: r.ok },
    );
  }
  if (protocol === 'WebAuthn') {
    const tx = await m.execute();
    clock.offsetMs = (config.challengeTtlSeconds + 1) * 1000;
    const r = await m.verify(tx);
    return outcome(
      r.ok ? 'fail' : 'pass',
      r.ok ? 'An assertion for an expired challenge was accepted.' : `An assertion returned ${config.challengeTtlSeconds + 1} s after the challenge was issued (TTL ${config.challengeTtlSeconds} s) was rejected (${r.reason}).`,
      { challengeTtlSeconds: config.challengeTtlSeconds, accepted: r.ok, reason: r.reason ?? null },
    );
  }
  // HOTP: event-based, so there is no expiry to test. Show what that means.
  const tx = await m.execute();
  clock.offsetMs = 24 * 3600 * 1000;
  const r = await m.verify(tx);
  return outcome(
    'not-applicable',
    `HOTP codes have no time-based expiry. An unused code generated 24 h earlier was ${r.ok ? 'still accepted' : 'rejected'}; a captured but unused HOTP code stays valid until a later code is used.`,
    { acceptedAfter24h: r.ok },
  );
}

async function desync(protocol, config, fresh) {
  if (protocol === 'HOTP') {
    const W = config.lookAheadWindow;
    const { m } = await fresh();
    const inside = await m.verify(await m.execute({ counterDrift: W }));
    const { m: m2 } = await fresh();
    const outside = await m2.verify(await m2.execute({ counterDrift: W + 1 }));
    await m2.reset();
    const asDesigned = inside.ok && !outside.ok;
    return outcome(
      asDesigned ? 'pass' : 'fail',
      `A token ${W} presses ahead was accepted and the server resynchronised (counter → ${inside.meta?.serverCounter}); a token ${W + 1} presses ahead fell outside the look-ahead window and was rejected. Counter desynchronisation beyond the window needs manual resynchronisation (Chapter 2 §2.4.1.3).`,
      { lookAheadWindow: W, driftInsideWindow: { drift: W, accepted: inside.ok, serverCounterAfter: inside.meta?.serverCounter ?? null }, driftOutsideWindow: { drift: W + 1, accepted: outside.ok } },
    );
  }
  if (protocol === 'TOTP') {
    const step = config.timeStep;
    const results = {};
    for (const skew of [-(config.window * step), config.window * step, (config.window + 1) * step, -(config.window + 1) * step]) {
      const { m } = await fresh({ clockSkewSeconds: 0 });
      results[`${skew}s`] = (await m.verify(await m.execute({ clockSkewSeconds: skew }))).ok;
      await m.reset();
    }
    const asDesigned = results[`${config.window * step}s`] && results[`${-(config.window * step)}s`] && !results[`${(config.window + 1) * step}s`] && !results[`${-(config.window + 1) * step}s`];
    return outcome(
      asDesigned ? 'pass' : 'fail',
      `Clock drift of up to ±${config.window * step} s (±${config.window} step) was tolerated; drift of ±${(config.window + 1) * step} s was rejected. The validation window trades clock tolerance against how long a code stays usable.`,
      { timeStep: step, window: config.window, acceptedBySkew: results },
    );
  }
  if (protocol === 'OOB Email') {
    return outcome('not-applicable', 'No shared counter or clock: each code is generated by the server per transaction and governed only by its expiry timestamp.', {});
  }
  return outcome('not-applicable', 'Challenge-response with a fresh server challenge per ceremony: no counter or clock must agree. The signature counter is used only for clone detection.', {});
}
