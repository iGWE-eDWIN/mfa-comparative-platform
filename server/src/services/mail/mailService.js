import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { PROVIDERS } from './providers.js';
import { startLocalSink } from './localSink.js';
import { withTimeout } from '../../lib/timing.js';

const PROBE_TIMEOUT_MS = Number(process.env.MAIL_PROBE_TIMEOUT_MS ?? 8000);

/**
 * Mailer with a provider abstraction (MAIL_PROVIDER=ethereal|brevo|gmail|mailtrap|local).
 * One instance is created per process/worker; the transport is pooled so that the send-time
 * metric reflects message submission rather than repeated TCP/TLS handshakes.
 */
export class Mailer {
  /** @param {{ provider?: string, pool?: boolean, fallbackLocal?: boolean, startSink?: boolean }} [opts] */
  constructor(opts = {}) {
    // Benchmark workers pass startSink=false: the sink must run on the API thread, not on the measured thread.
    this.startSink = opts.startSink ?? true;
    this.requested = opts.provider ?? env.MAIL_PROVIDER;
    this.pool = opts.pool ?? true;
    this.fallbackLocal = opts.fallbackLocal ?? env.MAIL_FALLBACK_LOCAL;
    this.transporter = null;
    this.info = null;
    this.fallbackReason = null;
  }

  /** Resolve the provider once; concurrent callers share the same initialisation. */
  init() {
    this.initPromise ??= this.#resolve().catch((err) => {
      this.initPromise = null;
      throw err;
    });
    return this.initPromise;
  }

  async #resolve() {
    let provider = this.requested;
    let built;
    const fallBack = async (reason) => {
      this.fallbackReason = `Ethereal unavailable (${reason}); using local SMTP sink`;
      logger.warn(this.fallbackReason);
      provider = 'local';
      return PROVIDERS.local();
    };
    try {
      built = await PROVIDERS[provider]();
    } catch (err) {
      if (provider !== 'ethereal' || !this.fallbackLocal) throw err;
      built = await fallBack(err.message);
    }
    if (provider === 'ethereal' && this.fallbackLocal) {
      // The account API can be reachable while outbound SMTP is blocked (common on hosting free
      // tiers and campus networks), so probe the SMTP connection before relying on it.
      const probe = this.#createTransport(built.transport);
      try {
        await withTimeout(probe.verify(), PROBE_TIMEOUT_MS, 'SMTP connection to Ethereal');
      } catch (err) {
        built = await fallBack(err.message);
      } finally {
        probe.close();
      }
    }
    if (provider === 'local' && this.startSink) {
      // The sink may bind an ephemeral port (LOCAL_SMTP_PORT=0); connect to the port it actually got.
      const port = await startLocalSink(built.transport.port);
      built.transport.port = port;
      built.info.port = port;
    }
    this.transporter = this.#createTransport(built.transport);
    this.info = {
      ...built.info,
      requested: this.requested,
      fallbackReason: this.fallbackReason,
      pooled: this.pool,
    };
    return this.info;
  }

  #createTransport(transport) {
    return nodemailer.createTransport({
      ...transport,
      pool: this.pool,
      maxConnections: 1,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }

  /** Check connectivity and authentication without sending anything. */
  async verifyConnection() {
    await this.init();
    await this.transporter.verify();
    return true;
  }

  /**
   * Send a one-time code. The code appears only in the message body, never in logs.
   * @returns {Promise<{ messageId: string, previewUrl: string|null, accepted: string[] }>}
   */
  async sendOtp({ to, code, expiresInSeconds, purpose = 'verification' }) {
    await this.init();
    const minutes = Math.round(expiresInSeconds / 60);
    const info = await this.transporter.sendMail({
      from: env.MAIL_FROM,
      to,
      subject: `Your ${purpose} code`,
      text: `Your one-time ${purpose} code is ${code}.\nIt expires in ${minutes} minute(s) and can be used once.\nIf you did not request it, ignore this email.`,
      html: `<p>Your one-time ${purpose} code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p><p>It expires in ${minutes} minute(s) and can be used once.</p>`,
    });
    const previewUrl =
      this.info.provider === 'ethereal' ? nodemailer.getTestMessageUrl(info) || null : null;
    return { messageId: info.messageId, previewUrl, accepted: info.accepted ?? [] };
  }

  close() {
    this.transporter?.close();
    this.transporter = null;
    this.initPromise = null;
  }
}

let shared = null;
/** Process-wide mailer for interactive flows. */
export function getMailer() {
  shared ??= new Mailer();
  return shared;
}
