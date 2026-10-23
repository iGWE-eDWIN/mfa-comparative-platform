import crypto from 'node:crypto';
import { z } from 'zod';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { ProtocolModule, fail } from '../ProtocolModule.js';
import { VirtualAuthenticatorSession } from '../../lib/virtualAuthenticator.js';

/**
 * WebAuthn/FIDO2 module (Chapter 3 §3.7.4) using a CDP Virtual Authenticator in headless
 * Chromium — software authenticator, not hardware (Chapter 1 §1.7).
 * Processing time = generateAuthenticationOptions + verifyAuthenticationResponse (server).
 * Latency additionally includes the browser ceremony (navigator.credentials.get).
 */
export class WebAuthnModule extends ProtocolModule {
  static protocolName = 'WebAuthn';
  static version = 'W3C WebAuthn Level 3 / FIDO2 (CTAP2 virtual authenticator)';
  static type = 'Public-key challenge-response';
  static schema = z.object({
    userVerification: z.enum(['required', 'preferred', 'discouraged']).default('preferred'),
    attestation: z.enum(['none', 'direct']).default('none'),
    algorithm: z.coerce
      .number()
      .int()
      .refine((v) => [-7, -257, -8].includes(v), 'Supported: -7 (ES256), -257 (RS256), -8 (EdDSA)')
      .default(-7),
    residentKey: z.enum(['required', 'preferred', 'discouraged']).default('preferred'),
    ceremonyTimeoutMs: z.coerce.number().int().min(1000).max(300000).default(60000),
    challengeTtlSeconds: z.coerce.number().int().min(10).max(600).default(120),
  });
  static metadata = {
    standard: 'W3C Web Authentication Level 3; FIDO Alliance CTAP2',
    factor: 'possession (+ inherence via user verification abstraction)',
    hardwareRequirement:
      'Optional/Required in practice (platform or roaming authenticator); here a software Virtual Authenticator',
    channelDependency: 'Platform/browser WebAuthn API',
    dependencies: [
      '@simplewebauthn/server',
      '@simplewebauthn/browser',
      'playwright-core (benchmark only)',
    ],
    implementationFiles: [
      'protocols/webauthn/index.js',
      'services/webauthnService.js',
      'lib/virtualAuthenticator.js',
    ],
  };

  get rp() {
    return this.ctx.rp;
  }

  async initialize() {
    const start = process.hrtime.bigint();
    this.challenges = new Map();
    this.session = await new VirtualAuthenticatorSession(await this.ctx.getBrowser()).open(
      this.rp.origin,
    );
    this.userId = crypto.randomBytes(16);
    const options = await generateRegistrationOptions({
      rpName: this.rp.name,
      rpID: this.rp.id,
      userName: 'benchmark-user',
      userID: this.userId,
      attestationType: this.config.attestation,
      timeout: this.config.ceremonyTimeoutMs,
      supportedAlgorithmIDs: [this.config.algorithm],
      authenticatorSelection: {
        residentKey: this.config.residentKey,
        userVerification: this.config.userVerification,
      },
    });
    const response = await this.session.register(options);
    const verifyStart = process.hrtime.bigint();
    const v = await verifyRegistrationResponse({
      response,
      expectedChallenge: options.challenge,
      expectedOrigin: this.rp.origin,
      expectedRPID: this.rp.id,
      requireUserVerification: this.config.userVerification === 'required',
      supportedAlgorithmIDs: [this.config.algorithm],
    });
    const registrationVerifyNs = process.hrtime.bigint() - verifyStart;
    if (!v.verified) throw new Error('WebAuthn registration could not be verified');
    const c = v.registrationInfo.credential;
    this.credential = {
      id: c.id,
      publicKey: c.publicKey,
      counter: c.counter,
      transports: c.transports,
    };
    const enrolmentNs = process.hrtime.bigint() - start;
    this.observations = {
      authenticator: 'CDP virtual authenticator (ctap2, internal, resident key, UV)',
      attestationFormat: v.registrationInfo.fmt,
      credentialDeviceType: v.registrationInfo.credentialDeviceType,
      registrationServerVerifyMs: Number(registrationVerifyNs) / 1e6,
      ceremonyRejectedByBrowser: 0,
      verificationFailures: 0,
      lastSignCount: c.counter,
      browserCpuIncluded: false,
    };
    return { enrolmentNs };
  }

  /** @param {{ origin?: string, signal?: never }} [options] origin lets the simulator run the ceremony from a phishing origin */
  async execute(options = {}) {
    const start = process.hrtime.bigint();
    const optionsJSON = await generateAuthenticationOptions({
      rpID: this.rp.id,
      allowCredentials: [{ id: this.credential.id, transports: this.credential.transports }],
      userVerification: this.config.userVerification,
      timeout: this.config.ceremonyTimeoutMs,
    });
    const challengeId = crypto.randomUUID();
    this.challenges.set(challengeId, {
      challenge: optionsJSON.challenge,
      expiresAt: this.ctx.now() + this.config.challengeTtlSeconds * 1000,
    });
    const serverNs = process.hrtime.bigint() - start;

    const ceremonyStart = process.hrtime.bigint();
    await this.session.goto(options.origin ?? this.rp.origin);
    const out = await this.session.authenticate(optionsJSON);
    const ceremonyNs = process.hrtime.bigint() - ceremonyStart;
    return {
      artifact: { challengeId, ...out },
      serverNs,
      meta: { ceremonyNs, origin: this.session.currentOrigin },
    };
  }

  async verify(tx) {
    const start = process.hrtime.bigint();
    const elapsed = () => process.hrtime.bigint() - start;
    const { challengeId, response, error } = tx.artifact;
    const stored = this.challenges.get(challengeId);
    // Single use: the challenge is consumed whatever the outcome.
    this.challenges.delete(challengeId);
    if (error) {
      this.observations.ceremonyRejectedByBrowser++;
      return fail('ceremony_rejected', elapsed(), { browserError: error });
    }
    if (!stored) return fail('unknown_or_used_challenge', elapsed());
    if (this.ctx.now() > stored.expiresAt) return fail('challenge_expired', elapsed());
    try {
      const v = await verifyAuthenticationResponse({
        response,
        expectedChallenge: stored.challenge,
        expectedOrigin: this.rp.origin,
        expectedRPID: this.rp.id,
        credential: this.credential,
        requireUserVerification: this.config.userVerification === 'required',
      });
      const serverNs = elapsed();
      if (!v.verified) {
        this.observations.verificationFailures++;
        return fail('signature_invalid', serverNs);
      }
      this.credential.counter = v.authenticationInfo.newCounter;
      this.observations.lastSignCount = v.authenticationInfo.newCounter;
      return {
        ok: true,
        serverNs,
        meta: { serverVerifyNs: serverNs, userVerified: v.authenticationInfo.userVerified },
      };
    } catch (err) {
      this.observations.verificationFailures++;
      return fail('verification_failed', elapsed(), { message: err.message });
    }
  }

  async reset() {
    await this.session?.close();
    this.session = null;
    this.challenges?.clear();
    await super.reset();
  }
}
