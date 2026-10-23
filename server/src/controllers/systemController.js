import { Protocol } from '../models/index.js';
import { dbStatus } from '../config/db.js';
import { benchmarkState } from '../services/benchmark/benchmarkService.js';
import { getMailer } from '../services/mail/mailService.js';
import { env } from '../config/env.js';
import { LITERATURE_TABLE_2_1 } from '../services/literature.js';

export async function health(_req, res) {
  const db = dbStatus();
  res.status(db === 'connected' ? 200 : 503).json({ status: db === 'connected' ? 'ok' : 'degraded', db });
}

/** Dashboard "system status" card. */
export async function status(_req, res) {
  const mailer = getMailer();
  res.json({
    db: dbStatus(),
    benchmark: benchmarkState(),
    mail: mailer.info ? { provider: mailer.info.provider, tls: mailer.info.tls, fallbackReason: mailer.info.fallbackReason } : { provider: env.MAIL_PROVIDER, initialised: false },
    webauthn: { rpId: env.WEBAUTHN_RP_ID, origin: env.WEBAUTHN_ORIGIN, authenticator: 'CDP Virtual Authenticator (benchmarks); browser authenticator (simulator)' },
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
  });
}

export async function protocols(_req, res) {
  res.json({ items: await Protocol.find({}, { implementation: 0 }).sort({ name: 1 }).lean() });
}

export function literature(_req, res) {
  res.json(LITERATURE_TABLE_2_1);
}
