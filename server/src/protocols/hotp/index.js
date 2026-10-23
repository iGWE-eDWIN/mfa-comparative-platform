import crypto from 'node:crypto';
import { z } from 'zod';
import { ProtocolModule, fail } from '../ProtocolModule.js';
import { hotp, verifyHotp } from '../../lib/otp.js';
import { encrypt, decrypt } from '../../lib/crypto.js';

export const SECRET_BYTES = { SHA1: 20, SHA256: 32, SHA512: 64 };

/**
 * HOTP module — RFC 4226 counter-based OTP (Chapter 3 §3.7.1).
 * Server state: AES-GCM-encrypted secret + next expected counter. The "token" is a software
 * simulation of a hardware/app token holding its own counter; `counterDrift` makes it run ahead
 * of the server (button presses without logging in) to observe resynchronisation.
 */
export class HotpModule extends ProtocolModule {
  static protocolName = 'HOTP';
  static version = 'RFC 4226';
  static type = 'OTP (event-based, symmetric HMAC)';
  static schema = z.object({
    digits: z.coerce.number().int().min(6).max(8).default(6),
    algorithm: z.enum(['SHA1', 'SHA256', 'SHA512']).default('SHA1'),
    lookAheadWindow: z.coerce.number().int().min(0).max(100).default(10),
    counterDrift: z.coerce.number().int().min(0).max(1000).default(0),
    maxAttempts: z.coerce.number().int().min(1).max(100).default(5),
  });
  static metadata = {
    standard: 'IETF RFC 4226',
    factor: 'possession',
    hardwareRequirement: 'Optional (hardware token or software authenticator app)',
    channelDependency: 'None (offline token)',
    dependencies: ['node:crypto'],
    implementationFiles: [
      'protocols/hotp/index.js',
      'lib/otp.js',
      'lib/crypto.js',
      'services/otpCredentialService.js',
    ],
  };

  async initialize() {
    const start = process.hrtime.bigint();
    const secret = crypto.randomBytes(SECRET_BYTES[this.config.algorithm]);
    this.server = {
      envelope: encrypt(secret, this.ctx.keys.encryptionKey, 'HOTP'),
      counter: 0,
      failedAttempts: 0,
      locked: false,
    };
    const enrolmentNs = process.hrtime.bigint() - start;
    this.token = { secret, counter: 0 };
    this.observations = {
      resyncCount: 0,
      maxAcceptedDrift: 0,
      rejectedOutsideWindow: 0,
      lockouts: 0,
    };
    return { enrolmentNs };
  }

  /**
   * Claimant side: the token produces its next code. No server issuance for HOTP (serverNs = 0).
   * @param {{ counterDrift?: number }} [options]
   */
  async execute(options = {}) {
    const drift = options.counterDrift ?? this.config.counterDrift;
    this.token.counter += drift;
    const code = hotp(this.token.secret, this.token.counter, this.config);
    const tx = { artifact: { code }, serverNs: 0n, meta: { tokenCounter: this.token.counter } };
    this.token.counter += 1;
    return tx;
  }

  async verify(tx) {
    const start = process.hrtime.bigint();
    const s = this.server;
    if (s.locked) return fail('locked', process.hrtime.bigint() - start);
    const secret = decrypt(s.envelope, this.ctx.keys.encryptionKey, 'HOTP');
    const r = verifyHotp(secret, String(tx.artifact.code), s.counter, this.config);
    if (r.ok) {
      // Advance past the matched counter so the same code can never be accepted again.
      s.counter = r.matchedCounter + 1;
      s.failedAttempts = 0;
    } else {
      s.failedAttempts += 1;
      if (s.failedAttempts >= this.config.maxAttempts) s.locked = true;
    }
    const serverNs = process.hrtime.bigint() - start;
    if (!r.ok) {
      this.observations.rejectedOutsideWindow++;
      if (s.locked) this.observations.lockouts++;
      return fail('invalid_code', serverNs, { serverCounter: s.counter });
    }
    if (r.drift > 0) this.observations.resyncCount++;
    this.observations.maxAcceptedDrift = Math.max(this.observations.maxAcceptedDrift, r.drift);
    return { ok: true, serverNs, meta: { drift: r.drift, serverCounter: s.counter } };
  }

  collectMetrics() {
    return {
      ...this.observations,
      serverCounter: this.server?.counter,
      tokenCounter: this.token?.counter,
      lookAheadWindow: this.config?.lookAheadWindow,
      counterDriftPerIteration: this.config?.counterDrift,
    };
  }

  /** Test hook for the security simulator: force the token's counter (desynchronisation). */
  setTokenCounter(counter) {
    this.token.counter = counter;
  }

  /** Clear a lockout (an administrator unlock in a real deployment). */
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
