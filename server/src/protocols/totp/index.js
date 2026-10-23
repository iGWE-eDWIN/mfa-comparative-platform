import crypto from 'node:crypto';
import { z } from 'zod';
import { ProtocolModule, fail } from '../ProtocolModule.js';
import { zBool } from '../schemaHelpers.js';
import { totp, verifyTotp } from '../../lib/otp.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { SECRET_BYTES } from '../hotp/index.js';

/**
 * TOTP module — RFC 6238 time-based OTP (Chapter 3 §3.7.2).
 * `clockSkewSeconds` offsets the simulated authenticator's clock from the server's to observe
 * clock-drift outcomes. `advanceClockPerIteration` moves a simulated clock forward one time
 * step per authentication so every iteration is a fresh login rather than a rejected replay
 * of the same step (the compute performed is identical; see docs/DECISIONS.md D14).
 */
export class TotpModule extends ProtocolModule {
  static protocolName = 'TOTP';
  static version = 'RFC 6238';
  static type = 'OTP (time-based, symmetric HMAC)';
  static schema = z.object({
    digits: z.coerce.number().int().min(6).max(8).default(6),
    algorithm: z.enum(['SHA1', 'SHA256', 'SHA512']).default('SHA1'),
    timeStep: z.coerce.number().int().min(5).max(300).default(30),
    window: z.coerce.number().int().min(0).max(10).default(1),
    clockSkewSeconds: z.coerce.number().int().min(-3600).max(3600).default(0),
    preventReuse: zBool(true),
    advanceClockPerIteration: zBool(true),
    maxAttempts: z.coerce.number().int().min(1).max(100).default(5),
  });
  static metadata = {
    standard: 'IETF RFC 6238',
    factor: 'possession',
    hardwareRequirement: 'None (authenticator app on an existing phone)',
    channelDependency: 'None (offline, requires roughly synchronised clocks)',
    dependencies: ['node:crypto', 'qrcode'],
    implementationFiles: ['protocols/totp/index.js', 'lib/otp.js', 'lib/crypto.js', 'lib/base32.js', 'services/otpCredentialService.js'],
  };

  /** Server clock in seconds, including the simulated offset. */
  serverNow() {
    return Math.floor(this.ctx.now() / 1000) + this.simOffset;
  }

  async initialize() {
    const start = process.hrtime.bigint();
    const secret = crypto.randomBytes(SECRET_BYTES[this.config.algorithm]);
    this.server = {
      envelope: encrypt(secret, this.ctx.keys.encryptionKey, 'TOTP'),
      lastUsedStep: null,
      failedAttempts: 0,
      locked: false,
    };
    const enrolmentNs = process.hrtime.bigint() - start;
    this.token = { secret };
    this.simOffset = 0;
    this.observations = { acceptedDriftSteps: {}, rejectedOutsideWindow: 0, replayRejected: 0, lockouts: 0 };
    return { enrolmentNs };
  }

  /** @param {{ clockSkewSeconds?: number }} [options] */
  async execute(options = {}) {
    if (this.config.advanceClockPerIteration) this.simOffset += this.config.timeStep;
    const skew = options.clockSkewSeconds ?? this.config.clockSkewSeconds;
    const tokenTime = this.serverNow() + skew;
    const code = totp(this.token.secret, tokenTime, { step: this.config.timeStep, digits: this.config.digits, algorithm: this.config.algorithm });
    return { artifact: { code }, serverNs: 0n, meta: { tokenTime } };
  }

  async verify(tx) {
    const start = process.hrtime.bigint();
    const s = this.server;
    if (s.locked) return fail('locked', process.hrtime.bigint() - start);
    const secret = decrypt(s.envelope, this.ctx.keys.encryptionKey, 'TOTP');
    const r = verifyTotp(secret, String(tx.artifact.code), this.serverNow(), {
      step: this.config.timeStep,
      window: this.config.window,
      digits: this.config.digits,
      algorithm: this.config.algorithm,
      lastUsedStep: this.config.preventReuse ? s.lastUsedStep : null,
    });
    if (r.ok) {
      s.lastUsedStep = r.matchedStep;
      s.failedAttempts = 0;
    } else if (!r.replay) {
      s.failedAttempts += 1;
      if (s.failedAttempts >= this.config.maxAttempts) s.locked = true;
    }
    const serverNs = process.hrtime.bigint() - start;
    if (r.replay) {
      this.observations.replayRejected++;
      return fail('replayed_code', serverNs, { matchedStep: r.matchedStep });
    }
    if (!r.ok) {
      this.observations.rejectedOutsideWindow++;
      if (s.locked) this.observations.lockouts++;
      return fail('invalid_code', serverNs);
    }
    const key = String(r.drift);
    this.observations.acceptedDriftSteps[key] = (this.observations.acceptedDriftSteps[key] ?? 0) + 1;
    return { ok: true, serverNs, meta: { driftSteps: r.drift, matchedStep: r.matchedStep } };
  }

  collectMetrics() {
    return {
      ...this.observations,
      timeStep: this.config?.timeStep,
      window: this.config?.window,
      clockSkewSeconds: this.config?.clockSkewSeconds,
      preventReuse: this.config?.preventReuse,
      simulatedClock: this.config?.advanceClockPerIteration,
    };
  }

  /** Test hook for simulations: move the simulated clock (expiry, drift). */
  advanceClock(seconds) {
    this.simOffset += seconds;
  }

  unlock() {
    this.server.locked = false;
    this.server.failedAttempts = 0;
  }

  async reset() {
    this.server = null;
    this.token = null;
    await super.reset();
  }
}
