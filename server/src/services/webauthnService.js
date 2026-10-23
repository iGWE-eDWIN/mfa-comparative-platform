import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { env } from '../config/env.js';
import { Credential, WebAuthnChallenge } from '../models/index.js';
import { HttpError } from '../middleware/errors.js';
import { audit } from './auditService.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const rp = () => ({ rpID: env.WEBAUTHN_RP_ID, rpName: env.WEBAUTHN_RP_NAME, origin: env.WEBAUTHN_ORIGIN });

async function storeChallenge(user, ceremony, purpose, challenge) {
  await WebAuthnChallenge.deleteMany({ userId: user.id, ceremony, purpose });
  await WebAuthnChallenge.create({ userId: user.id, ceremony, purpose, challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) });
}

/** Fetch and delete (single use) the pending challenge. */
async function takeChallenge(user, ceremony, purpose) {
  const ch = await WebAuthnChallenge.findOneAndDelete({ userId: user.id, ceremony, purpose });
  if (!ch || ch.expiresAt < new Date()) throw new HttpError(400, 'No pending WebAuthn challenge (expired or already used)', 'CHALLENGE_MISSING');
  return ch.challenge;
}

export async function registrationOptions(user) {
  const existing = await Credential.find({ userId: user.id, protocol: 'WebAuthn' }).lean();
  const options = await generateRegistrationOptions({
    rpName: rp().rpName,
    rpID: rp().rpID,
    userName: user.username,
    userDisplayName: user.username,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.webauthn.credentialId, transports: c.webauthn.transports })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
  await storeChallenge(user, 'registration', 'simulator', options.challenge);
  return options;
}

export async function verifyRegistration(user, response) {
  const expectedChallenge = await takeChallenge(user, 'registration', 'simulator');
  const start = process.hrtime.bigint();
  let v;
  try {
    v = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: rp().origin, expectedRPID: rp().rpID, requireUserVerification: false });
  } catch (err) {
    await audit(user.id, 'webauthn.registration_failed', { error: err.message });
    throw new HttpError(400, `Registration verification failed: ${err.message}`, 'WEBAUTHN_REGISTRATION_FAILED');
  }
  const serverVerifyTimeMs = Number(process.hrtime.bigint() - start) / 1e6;
  if (!v.verified) throw new HttpError(400, 'Registration could not be verified', 'WEBAUTHN_REGISTRATION_FAILED');
  const c = v.registrationInfo.credential;
  const cred = await Credential.create({
    userId: user.id,
    protocol: 'WebAuthn',
    label: `Passkey (${v.registrationInfo.credentialDeviceType})`,
    status: 'active',
    webauthn: { credentialId: c.id, publicKey: isoBase64URL.fromBuffer(c.publicKey), signCount: c.counter, transports: c.transports ?? [], deviceType: v.registrationInfo.credentialDeviceType, backedUp: v.registrationInfo.credentialBackedUp, aaguid: v.registrationInfo.aaguid },
  });
  await audit(user.id, 'webauthn.registered', { credentialId: String(cred._id), aaguid: v.registrationInfo.aaguid });
  return { credentialId: String(cred._id), serverVerifyTimeMs, attestationFormat: v.registrationInfo.fmt, deviceType: v.registrationInfo.credentialDeviceType };
}

export async function authenticationOptions(user, purpose = 'simulator') {
  const creds = await Credential.find({ userId: user.id, protocol: 'WebAuthn', status: 'active' }).lean();
  if (!creds.length) throw new HttpError(400, 'No WebAuthn credential registered', 'NO_CREDENTIAL');
  const options = await generateAuthenticationOptions({ rpID: rp().rpID, allowCredentials: creds.map((c) => ({ id: c.webauthn.credentialId, transports: c.webauthn.transports })), userVerification: 'preferred' });
  await storeChallenge(user, 'authentication', purpose, options.challenge);
  return options;
}

export async function verifyAuthentication(user, response, purpose = 'simulator') {
  const expectedChallenge = await takeChallenge(user, 'authentication', purpose);
  const cred = await Credential.findOne({ userId: user.id, protocol: 'WebAuthn', 'webauthn.credentialId': response?.id });
  if (!cred) throw new HttpError(400, 'Unknown credential', 'UNKNOWN_CREDENTIAL');
  const start = process.hrtime.bigint();
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp().origin,
      expectedRPID: rp().rpID,
      credential: { id: cred.webauthn.credentialId, publicKey: isoBase64URL.toBuffer(cred.webauthn.publicKey), counter: cred.webauthn.signCount, transports: cred.webauthn.transports },
      requireUserVerification: false,
    });
  } catch (err) {
    await audit(user.id, 'webauthn.authentication_failed', { purpose, error: err.message });
    return { ok: false, reason: 'verification_failed', message: err.message, serverVerifyTimeMs: Number(process.hrtime.bigint() - start) / 1e6 };
  }
  const serverVerifyTimeMs = Number(process.hrtime.bigint() - start) / 1e6;
  if (!v.verified) return { ok: false, reason: 'signature_invalid', serverVerifyTimeMs };
  await Credential.updateOne({ _id: cred._id }, { $set: { 'webauthn.signCount': v.authenticationInfo.newCounter, lastUsedAt: new Date() } });
  await audit(user.id, 'webauthn.authenticated', { purpose, credentialId: String(cred._id) });
  return { ok: true, serverVerifyTimeMs, userVerified: v.authenticationInfo.userVerified, newCounter: v.authenticationInfo.newCounter, credentialId: String(cred._id) };
}
