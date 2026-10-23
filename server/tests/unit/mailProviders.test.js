import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProtocolModule } from '../../src/protocols/ProtocolModule.js';

const DATA = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../.data/ethereal-account.json',
);

async function providersWith(envOverrides) {
  vi.resetModules();
  for (const [k, v] of Object.entries(envOverrides)) vi.stubEnv(k, v);
  return import('../../src/services/mail/providers.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Mail provider abstraction', () => {
  it('real providers require TLS and credentials from env (never hard-coded)', async () => {
    const { PROVIDERS } = await providersWith({
      BREVO_SMTP_USER: 'u@x',
      BREVO_SMTP_KEY: 'k',
      GMAIL_USER: 'g@x',
      GMAIL_APP_PASSWORD: 'p',
      MAILTRAP_USER: 'm',
      MAILTRAP_PASS: 'q',
    });
    const brevo = await PROVIDERS.brevo();
    expect(brevo.transport).toMatchObject({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'u@x', pass: 'k' },
    });
    expect(brevo.transport.tls?.rejectUnauthorized).not.toBe(false);
    expect((await PROVIDERS.gmail()).transport).toMatchObject({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
    });
    expect((await PROVIDERS.mailtrap()).transport).toMatchObject({
      host: 'sandbox.smtp.mailtrap.io',
      port: 2525,
      requireTLS: true,
    });
    expect((await PROVIDERS.local()).transport).toMatchObject({
      host: '127.0.0.1',
      requireTLS: true,
    });
  });
  it('reports a clear 503 when a provider is not configured', async () => {
    const { PROVIDERS } = await providersWith({
      BREVO_SMTP_USER: '',
      BREVO_SMTP_KEY: '',
      GMAIL_USER: '',
      MAILTRAP_USER: '',
    });
    await expect(PROVIDERS.brevo()).rejects.toMatchObject({
      status: 503,
      code: 'MAIL_NOT_CONFIGURED',
    });
    await expect(PROVIDERS.gmail()).rejects.toMatchObject({ code: 'MAIL_NOT_CONFIGURED' });
    await expect(PROVIDERS.mailtrap()).rejects.toMatchObject({ code: 'MAIL_NOT_CONFIGURED' });
  });
  it('ethereal: creates a test account once and caches it', async () => {
    const backup = await fs.readFile(DATA, 'utf8').catch(() => null);
    await fs.rm(DATA, { force: true });
    try {
      const { PROVIDERS } = await providersWith({});
      const nodemailer = (await import('nodemailer')).default;
      const spy = vi
        .spyOn(nodemailer, 'createTestAccount')
        .mockResolvedValue({
          user: 'eth@ethereal.email',
          pass: 'pw',
          smtp: { host: 'smtp.ethereal.email', port: 587 },
          web: 'https://ethereal.email',
        });
      const first = await PROVIDERS.ethereal();
      expect(first.transport).toMatchObject({
        host: 'smtp.ethereal.email',
        requireTLS: true,
        auth: { user: 'eth@ethereal.email' },
      });
      expect(first.info.previewSupported).toBe(true);
      await PROVIDERS.ethereal();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(DATA, { force: true });
      if (backup) await fs.writeFile(DATA, backup);
    }
  });
  it('Mailer falls back from Ethereal to the local sink and records why', async () => {
    vi.resetModules();
    const providers = await import('../../src/services/mail/providers.js');
    vi.spyOn(providers.PROVIDERS, 'ethereal').mockRejectedValue(new Error('network unreachable'));
    const { Mailer } = await import('../../src/services/mail/mailService.js');
    const { stopLocalSink, localInbox } = await import('../../src/services/mail/localSink.js');
    const m = new Mailer({ provider: 'ethereal', fallbackLocal: true, pool: false });
    const info = await m.init();
    expect(info).toMatchObject({ provider: 'local', requested: 'ethereal' });
    expect(info.fallbackReason).toMatch(/network unreachable/);
    expect(await m.verifyConnection()).toBe(true);
    const sent = await m.sendOtp({ to: 'x@example.test', code: '424242', expiresInSeconds: 300 });
    expect(sent.previewUrl).toBeNull();
    expect(localInbox('x@example.test')[0].raw).toContain('424242');
    const strict = new Mailer({ provider: 'ethereal', fallbackLocal: false });
    await expect(strict.init()).rejects.toThrow(/network unreachable/);
    m.close();
    await stopLocalSink();
  });
});

describe('ProtocolModule base class', () => {
  it('abstract operations throw and defaults derive from the schema', async () => {
    const base = new ProtocolModule({});
    await expect(base.initialize()).rejects.toThrow(/not implemented/);
    await expect(base.execute()).rejects.toThrow(/not implemented/);
    await expect(base.verify()).rejects.toThrow(/not implemented/);
    expect(base.collectMetrics()).toEqual({});
    await base.reset();
  });
});
