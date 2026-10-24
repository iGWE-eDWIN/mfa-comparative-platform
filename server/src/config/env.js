import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Load the repository-root .env (Node >= 20.12). Variables already set in the environment win.
// Tests never read .env so that a developer's settings cannot change test outcomes.
const ROOT_ENV = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
if (process.env.NODE_ENV !== 'test' && fs.existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);

/**
 * Environment configuration, validated once at start-up so that a misconfigured
 * deployment fails fast with a readable message instead of failing mid-request.
 */
const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/mfa_platform'),
  CLIENT_ORIGINS: z.string().default('http://localhost:5173'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters').optional(),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(7200),
  /** 32-byte key, hex (64 chars) or base64, used for AES-256-GCM encryption of protocol secrets. */
  SECRETS_ENCRYPTION_KEY: z.string().optional(),
  /** Server-side pepper for HMAC-SHA-256 hashing of OOB codes (combined with a per-record salt). */
  OTP_HMAC_KEY: z.string().min(32).optional(),
  COOKIE_SECURE: bool.optional(),

  MAIL_PROVIDER: z.enum(['ethereal', 'brevo', 'gmail', 'mailtrap', 'local']).default('ethereal'),
  MAIL_FROM: z.string().default('MFA Benchmark Platform <no-reply@mfa-platform.test>'),
  BREVO_SMTP_USER: z.string().optional(),
  BREVO_SMTP_KEY: z.string().optional(),
  BREVO_SMTP_PORT: z.coerce
    .number()
    .int()
    .refine((p) => [587, 2525, 465].includes(p), 'Use 587, 2525 or 465')
    .default(587),
  GMAIL_USER: z.string().optional(),
  GMAIL_APP_PASSWORD: z.string().optional(),
  MAILTRAP_USER: z.string().optional(),
  MAILTRAP_PASS: z.string().optional(),
  MAILTRAP_HOST: z.string().default('sandbox.smtp.mailtrap.io'),
  MAILTRAP_PORT: z.coerce.number().int().default(2525),
  BREVO_MAX_BENCH_EMAILS: z.coerce.number().int().positive().default(50),
  /** When true, a failed Ethereal account creation falls back to the local SMTP sink (D03). */
  MAIL_FALLBACK_LOCAL: bool.default(true),

  /** Default: Render's public hostname when deployed there, otherwise localhost. */
  WEBAUTHN_RP_ID: z.string().optional(),
  WEBAUTHN_RP_NAME: z.string().default('MFA Comparative Platform'),
  /** Default: Render's public URL when deployed there, otherwise the Vite dev origin. */
  WEBAUTHN_ORIGIN: z.string().optional(),
  /** Set automatically by Render (https://render.com/docs/environment-variables). */
  RENDER_EXTERNAL_URL: z.string().optional(),
  RENDER_EXTERNAL_HOSTNAME: z.string().optional(),
  /** Optional explicit Chrome/Chromium path for the WebAuthn benchmark (otherwise Playwright's). */
  CHROMIUM_PATH: z.string().optional(),

  BENCHMARK_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  BENCHMARK_MAX_ITERATIONS: z.coerce.number().int().positive().default(10000),
  SERVE_CLIENT: bool.default(false),
  /** Express "trust proxy": a hop count (e.g. 1 behind Render's proxy) or a name such as "loopback". */
  TRUST_PROXY: z.string().default('loopback'),
  /**
   * Show the test-mailbox preview link / local inbox in the UI. Always on outside production.
   * In production only for demo deployments whose mail goes to a test mailbox: it lets anyone who
   * knows a password read that account's email code, so OOB is then not a real second factor.
   */
  MAIL_TEST_INBOX_IN_UI: bool.default(false),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

/** @typedef {z.infer<typeof schema>} Env */

/** Empty values (e.g. `JWT_SECRET=` copied from .env.example) mean "not set". */
export function readEnv(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
}

function load() {
  const parsed = schema.safeParse(readEnv());
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  const env = parsed.data;
  const isProd = env.NODE_ENV === 'production';
  if (isProd) {
    for (const key of ['JWT_SECRET', 'SECRETS_ENCRYPTION_KEY', 'OTP_HMAC_KEY']) {
      if (!env[key]) throw new Error(`${key} is required in production`);
    }
  }
  // Development/test defaults are deterministic per process start but never used in production.
  env.usingDevSecrets = !env.JWT_SECRET || !env.SECRETS_ENCRYPTION_KEY || !env.OTP_HMAC_KEY;
  env.JWT_SECRET ??= 'dev-only-jwt-secret-change-me-0123456789abcdef';
  env.SECRETS_ENCRYPTION_KEY ??= '0'.repeat(63) + '1';
  env.OTP_HMAC_KEY ??= 'dev-only-otp-hmac-key-change-me-0123456789';
  env.COOKIE_SECURE ??= isProd;
  env.WEBAUTHN_ORIGIN ??= env.RENDER_EXTERNAL_URL ?? 'http://localhost:5173';
  env.WEBAUTHN_RP_ID ??= env.RENDER_EXTERNAL_HOSTNAME ?? 'localhost';
  env.clientOrigins = [
    ...new Set(
      [...env.CLIENT_ORIGINS.split(','), env.RENDER_EXTERNAL_URL ?? '']
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  env.trustProxy = /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY;
  env.showTestInbox = !isProd || env.MAIL_TEST_INBOX_IN_UI;
  return env;
}

/** @type {Env & { clientOrigins: string[] }} */
export const env = load();
