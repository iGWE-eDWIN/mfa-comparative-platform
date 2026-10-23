import { Credential } from '../models/index.js';
import { audit } from '../services/auditService.js';
import { HttpError } from '../middleware/errors.js';

const view = (c) => ({
  id: String(c._id),
  protocol: c.protocol,
  label: c.label,
  status: c.status,
  isLoginFactor: c.isLoginFactor,
  otp: c.otp,
  createdAt: c.createdAt,
  lastUsedAt: c.lastUsedAt,
  lockedUntil: c.lockedUntil,
});

export async function list(req, res) {
  const items = await Credential.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean();
  res.json({ items: items.map(view) });
}

/** Choose (or clear) the credential required as second factor at login. */
export async function update(req, res) {
  const cred = await Credential.findOne({ _id: req.params.id, userId: req.user.id });
  if (!cred) throw new HttpError(404, 'Credential not found', 'NOT_FOUND');
  if (req.body.isLoginFactor && cred.status !== 'active')
    throw new HttpError(400, 'Verify the credential once before using it at login', 'NOT_ACTIVE');
  if (req.body.isLoginFactor)
    await Credential.updateMany({ userId: req.user.id }, { $set: { isLoginFactor: false } });
  cred.isLoginFactor = req.body.isLoginFactor;
  await cred.save();
  await audit(
    req.user.id,
    req.body.isLoginFactor ? 'credential.login_factor_enabled' : 'credential.login_factor_disabled',
    { protocol: cred.protocol, credentialId: String(cred._id) },
  );
  res.json({ credential: view(cred) });
}

export async function remove(req, res) {
  const cred = await Credential.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  if (!cred) throw new HttpError(404, 'Credential not found', 'NOT_FOUND');
  await audit(req.user.id, 'credential.deleted', {
    protocol: cred.protocol,
    credentialId: String(cred._id),
  });
  res.status(204).end();
}
