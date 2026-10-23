import { z } from 'zod';

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
  GMAIL_USER: z.string().optional(),
  GMAIL_APP_PASSWORD: z.string().optional(),
  MAILTRAP_USER: z.string().optional(),
  MAILTRAP_PASS: z.string().optional(),
  MAILTRAP_HOST: z.string().default('sandbox.smtp.mailtrap.io'),
  MAILTRAP_PORT: z.coerce.number().int().default(2525),
  BREVO_MAX_BENCH_EMAILS: z.coerce.number().int().positive().default(50),
  /** When true, a failed Ethereal account creation falls back to the local SMTP sink (D03). */
  MAIL_FALLBACK_LOCAL: bool.default(true),

  WEBAUTHN_RP_ID: z.string().default('localhost'),
  WEBAUTHN_RP_NAME: z.string().default('MFA Comparative Platform'),
  WEBAUTHN_ORIGIN: z.string().default('http://localhost:5173'),
  /** Optional explicit Chrome/Chromium path for the WebAuthn benchmark (otherwise Playwright's). */
  CHROMIUM_PATH: z.string().optional(),

  BENCHMARK_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  BENCHMARK_MAX_ITERATIONS: z.coerce.number().int().positive().default(10000),
  SERVE_CLIENT: bool.default(false),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

/** @typedef {z.infer<typeof schema>} Env */

function load() {
  const parsed = schema.safeParse(process.env);
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
  env.JWT_SECRET ??= 'dev-only-jwt-secret-change-me-0123456789abcdef';
  env.SECRETS_ENCRYPTION_KEY ??= '0'.repeat(63) + '1';
  env.OTP_HMAC_KEY ??= 'dev-only-otp-hmac-key-change-me-0123456789';
  env.COOKIE_SECURE ??= isProd;
  env.clientOrigins = env.CLIENT_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return env;
}

/** @type {Env & { clientOrigins: string[] }} */
export const env = load();
