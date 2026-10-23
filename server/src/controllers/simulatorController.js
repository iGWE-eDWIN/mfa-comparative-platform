import { enrolOtp, verifyOtpCredential } from '../services/otpCredentialService.js';
import { sendOobCode, verifyOobCode, devInbox } from '../services/oobService.js';
import * as wa from '../services/webauthnService.js';
import { Credential } from '../models/index.js';

/** Single-flow simulators (FR4): each response carries the server-side timings of that step. */
export async function otpEnrol(req, res) {
  res.status(201).json(await enrolOtp(req.user, req.params.protocol.toUpperCase(), req.body.config));
}

export async function otpVerify(req, res) {
  res.json(await verifyOtpCredential(req.user, req.params.id, req.body.code, 'simulator'));
}

export async function oobSend(req, res) {
  res.json(await sendOobCode(req.user, 'simulator'));
}

export async function oobVerify(req, res) {
  const r = await verifyOobCode(req.user, req.body.challengeId, req.body.code, 'simulator');
  if (r.ok) {
    // Proving mailbox control once makes email available as a login factor.
    await Credential.updateOne({ userId: req.user.id, protocol: 'OOB Email' }, { $setOnInsert: { userId: req.user.id, protocol: 'OOB Email', label: 'Email code', status: 'active' } }, { upsert: true });
  }
  res.json(r);
}

export function oobInbox(req, res) {
  res.json({ messages: devInbox(req.user) });
}

export async function waRegisterOptions(req, res) {
  res.json(await wa.registrationOptions(req.user));
}
export async function waRegisterVerify(req, res) {
  res.status(201).json(await wa.verifyRegistration(req.user, req.body.response));
}
export async function waAuthOptions(req, res) {
  res.json(await wa.authenticationOptions(req.user, 'simulator'));
}
export async function waAuthVerify(req, res) {
  res.json(await wa.verifyAuthentication(req.user, req.body.response, 'simulator'));
}
