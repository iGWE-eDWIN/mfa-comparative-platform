import crypto from 'node:crypto';
import { z } from 'zod';
import { ProtocolModule, fail } from '../ProtocolModule.js';
import { zBool } from '../schemaHelpers.js';
import { hashCode, newSalt, randomNumericCode, safeEqual } from '../../lib/crypto.js';

/**
 * OOB Email module (Chapter 3 §3.7.3; email only, no SMS).
 * Issuance: crypto.randomInt code → HMAC-SHA-256(pepper, salt‖code) stored with expiry,
 * attempt counter, single-use flag and resend cooldown → email delivery through the configured
 * provider. Processing time covers generation + hashing + verification (server compute);
 * email send time is network/provider-dependent and is reported separately (meta.sendNs).
 */
export class OobEmailModule extends ProtocolModule {
  static protocolName = 'OOB Email';
  static version = 'Email OTP (NIST SP 800-63B out-of-band, email channel)';
  static type = 'Out-of-band one-time code';
  static schema = z.object({
    codeDigits: z.coerce.number().int().min(6).max(8).default(6),
    expirySeconds: z.coerce.number().int().min(30).max(900).default(300),
    maxAttempts: z.coerce.number().int().min(1).max(20).default(5),
    resendCooldownSeconds: z.coerce.number().int().min(0).max(600).default(30),
    sendEmail: zBool(true),
    recipient: z.string().email().default('benchmark-user@mfa-platform.test'),
  });
  static metadata = {
    standard: 'NIST SP 800-63B §5.1.3 (out-of-band), email channel',
    factor: 'possession (of the mailbox)',
    hardwareRequirement: 'None',
    channelDependency: 'SMTP / email provider (delivery time depends on provider and network)',
    dependencies: ['node:crypto', 'nodemailer'],
    implementationFiles: [
      'protocols/oobEmail/index.js',
      'lib/crypto.js',
      'services/mail/mailService.js',
      'services/mail/providers.js',
      'services/oobService.js',
    ],
  };

  async initialize() {
    const start = process.hrtime.bigint();
    this.challenges = new Map();
    let mailInfo = null;
    if (this.config.sendEmail) {
      if (!this.ctx.mailer) throw new Error('OOB Email requires a mailer in the module context');
      mailInfo = await this.ctx.mailer.init();
    }
    const enrolmentNs = process.hrtime.bigint() - start;
    this.observations = {
      provider: mailInfo?.provider ?? 'none (sendEmail=false)',
      providerInfo: mailInfo,
      delivered: 0,
      deliveryFailures: 0,
      lastPreviewUrl: null,
      expiredRejected: 0,
      attemptLimitReached: 0,
      reuseRejected: 0,
      resendBlockedByCooldown: 0,
    };
    return { enrolmentNs };
  }

  /** Server-side issuance only (generation + salted HMAC + storage). */
  issue() {
    const start = process.hrtime.bigint();
    const code = randomNumericCode(this.config.codeDigits);
    const salt = newSalt();
    const now = this.ctx.now();
    const id = crypto.randomUUID();
    this.challenges.set(id, {
      codeHash: hashCode(code, salt, this.ctx.keys.otpPepper),
      salt,
      attempts: 0,
      used: false,
      expiresAt: now + this.config.expirySeconds * 1000,
      resendAvailableAt: now + this.config.resendCooldownSeconds * 1000,
    });
    return { id, code, serverNs: process.hrtime.bigint() - start };
  }

  async deliver(code) {
    if (!this.config.sendEmail) return { sendNs: 0n, delivery: null };
    const start = process.hrtime.bigint();
    try {
      const delivery = await this.ctx.mailer.sendOtp({
        to: this.config.recipient,
        code,
        expiresInSeconds: this.config.expirySeconds,
        purpose: 'benchmark verification',
      });
      this.observations.delivered++;
      if (delivery.previewUrl) this.observations.lastPreviewUrl = delivery.previewUrl;
      return { sendNs: process.hrtime.bigint() - start, delivery };
    } catch (err) {
      this.observations.deliveryFailures++;
      const e = new Error(`Email delivery failed: ${err.message}`);
      e.code = 'DELIVERY_FAILED';
      throw e;
    }
  }

  async execute() {
    const { id, code, serverNs } = this.issue();
    const { sendNs } = await this.deliver(code);
    // The simulated user reads the code from the mailbox and submits it with the challenge id.
    return { artifact: { challengeId: id, code }, serverNs, meta: { sendNs } };
  }

  /**
   * Request a new code for an existing challenge, subject to the resend cooldown.
   * @returns {Promise<{ ok: boolean, reason?: string, tx?: object }>}
   */
  async resend(challengeId) {
    const ch = this.challenges.get(challengeId);
    if (!ch) return { ok: false, reason: 'unknown_challenge' };
    if (this.ctx.now() < ch.resendAvailableAt) {
      this.observations.resendBlockedByCooldown++;
      return { ok: false, reason: 'resend_cooldown' };
    }
    this.challenges.delete(challengeId);
    return { ok: true, tx: await this.execute() };
  }

  async verify(tx) {
    const start = process.hrtime.bigint();
    const elapsed = () => process.hrtime.bigint() - start;
    const ch = this.challenges.get(tx.artifact.challengeId);
    if (!ch) return fail('unknown_challenge', elapsed());
    if (ch.used) {
      this.observations.reuseRejected++;
      return fail('already_used', elapsed());
    }
    if (this.ctx.now() > ch.expiresAt) {
      this.observations.expiredRejected++;
      return fail('expired', elapsed());
    }
    if (ch.attempts >= this.config.maxAttempts) {
      this.observations.attemptLimitReached++;
      return fail('attempts_exceeded', elapsed());
    }
    const ok = safeEqual(
      hashCode(String(tx.artifact.code), ch.salt, this.ctx.keys.otpPepper),
      ch.codeHash,
    );
    if (ok) ch.used = true;
    else ch.attempts++;
    const serverNs = elapsed();
    return ok ? { ok: true, serverNs } : fail('invalid_code', serverNs, { attempts: ch.attempts });
  }

  collectMetrics() {
    const { providerInfo, ...rest } = this.observations;
    return {
      ...rest,
      tls: providerInfo?.tls ?? null,
      pooledTransport: providerInfo?.pooled ?? null,
      fallbackReason: providerInfo?.fallbackReason ?? null,
      outstandingChallenges: this.challenges?.size ?? 0,
    };
  }

  async reset() {
    this.challenges?.clear();
    await super.reset();
  }
}
