import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.data');
const ETHEREAL_CACHE = path.join(DATA_DIR, 'ethereal-account.json');

/**
 * SMTP transport options per provider. Real providers enforce STARTTLS (`requireTLS`) and
 * certificate validation, so a downgrade to plaintext SMTP fails instead of silently
 * sending the OTP in clear text (Chapter 2 §2.4.3.2).
 */
export const PROVIDERS = {
  async ethereal() {
    const account = await etherealAccount();
    return {
      transport: { host: account.smtp.host, port: account.smtp.port, secure: false, requireTLS: true, auth: { user: account.user, pass: account.pass } },
      info: { provider: 'ethereal', host: account.smtp.host, port: account.smtp.port, tls: 'STARTTLS (required)', previewSupported: true, user: account.user },
    };
  },
  async brevo() {
    if (!env.BREVO_SMTP_USER || !env.BREVO_SMTP_KEY) throw configError('BREVO_SMTP_USER and BREVO_SMTP_KEY');
    return {
      transport: { host: 'smtp-relay.brevo.com', port: 587, secure: false, requireTLS: true, auth: { user: env.BREVO_SMTP_USER, pass: env.BREVO_SMTP_KEY } },
      info: { provider: 'brevo', host: 'smtp-relay.brevo.com', port: 587, tls: 'STARTTLS (required)', previewSupported: false },
    };
  },
  async gmail() {
    if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) throw configError('GMAIL_USER and GMAIL_APP_PASSWORD');
    return {
      transport: { host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD } },
      info: { provider: 'gmail', host: 'smtp.gmail.com', port: 465, tls: 'implicit TLS', previewSupported: false },
    };
  },
  async mailtrap() {
    if (!env.MAILTRAP_USER || !env.MAILTRAP_PASS) throw configError('MAILTRAP_USER and MAILTRAP_PASS');
    return {
      transport: { host: env.MAILTRAP_HOST, port: env.MAILTRAP_PORT, secure: false, requireTLS: true, auth: { user: env.MAILTRAP_USER, pass: env.MAILTRAP_PASS } },
      info: { provider: 'mailtrap', host: env.MAILTRAP_HOST, port: env.MAILTRAP_PORT, tls: 'STARTTLS (required)', previewSupported: false },
    };
  },
  async local() {
    const port = Number(process.env.LOCAL_SMTP_PORT ?? 2526);
    return {
      // Loopback only; the sink uses a self-signed development certificate, hence rejectUnauthorized=false.
      transport: { host: '127.0.0.1', port, secure: false, requireTLS: true, tls: { rejectUnauthorized: false }, ignoreTLS: false },
      info: { provider: 'local', host: '127.0.0.1', port, tls: 'STARTTLS (required, self-signed, loopback)', previewSupported: true },
    };
  },
};

function configError(vars) {
  const err = new Error(`Mail provider is not configured: set ${vars} in .env`);
  err.status = 503;
  err.code = 'MAIL_NOT_CONFIGURED';
  return err;
}

/** Create (once) and cache an Ethereal test account; no signup required. */
async function etherealAccount() {
  try {
    return JSON.parse(await fs.readFile(ETHEREAL_CACHE, 'utf8'));
  } catch {
    // No cached account yet.
  }
  const account = await Promise.race([
    nodemailer.createTestAccount(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Ethereal account creation timed out')), 10000)),
  ]);
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(ETHEREAL_CACHE, JSON.stringify(account), { mode: 0o600 });
  logger.info({ user: account.user, web: account.web }, 'Created Ethereal test account');
  return account;
}
