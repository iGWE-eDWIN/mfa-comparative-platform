import { z } from 'zod';
import { env } from '../config/env.js';
import { PROTOCOL_NAMES } from '../models/Protocol.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
export const idParam = z.object({ id: objectId });

// Password policy: length over complexity (NIST SP 800-63B §5.1.1).
const password = z.string().min(10, 'Password must be at least 10 characters').max(128);

export const registerBody = z
  .object({
    username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/, 'Letters, digits, _ . - only'),
    email: z.string().trim().toLowerCase().email().max(254),
    password,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

export const loginBody = z.object({ identifier: z.string().trim().min(3).max(254), password: z.string().min(1).max(128) });

export const mfaVerifyBody = z.object({
  code: z.string().regex(/^\d{6,8}$/).optional(),
  challengeId: objectId.optional(),
  response: z.any().optional(),
});

export const jobCreateBody = z
  .object({
    protocols: z
      .array(z.object({ name: z.enum(PROTOCOL_NAMES), config: z.record(z.string(), z.any()).default({}) }))
      .min(1, 'Select at least one protocol')
      .max(4),
    iterations: z.coerce.number().int().min(1).max(env.BENCHMARK_MAX_ITERATIONS),
    warmupIterations: z.coerce.number().int().min(0).max(1000).default(10),
    timeoutMs: z.coerce.number().int().min(1000).max(6 * 3600 * 1000).default(10 * 60 * 1000),
    operationTimeoutMs: z.coerce.number().int().min(500).max(120000).default(15000),
    runSecuritySimulations: z.boolean().default(true),
    label: z.string().trim().max(100).default(''),
  })
  .refine((v) => new Set(v.protocols.map((p) => p.name)).size === v.protocols.length, { path: ['protocols'], message: 'Each protocol may be selected once' });

export const jobListQuery = z.object({
  status: z.enum(['Pending', 'Running', 'Completed', 'Failed', 'Cancelled']).optional(),
  protocol: z.enum(PROTOCOL_NAMES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const exportQuery = z.object({ format: z.enum(['csv', 'json']).default('json'), includeRaw: z.enum(['true', 'false']).default('true') });

const score = z.coerce.number().int().min(1).max(5);
export const assessmentBody = z.object({
  integration: z.object({ scores: z.record(z.string(), score).optional(), basis: z.record(z.string(), z.string().max(300)).optional(), observations: z.string().max(2000).optional() }).optional(),
  usability: z.object({ scores: z.record(z.string(), score).optional(), basis: z.record(z.string(), z.string().max(300)).optional(), observations: z.string().max(2000).optional() }).optional(),
});

export const otpEnrolBody = z.object({ config: z.record(z.string(), z.any()).default({}) });
export const otpProtocolParam = z.object({ protocol: z.enum(['hotp', 'totp']) });
export const codeBody = z.object({ code: z.string().trim().regex(/^\d{6,8}$/, 'Enter the 6–8 digit code') });
export const oobVerifyBody = z.object({ challengeId: objectId, code: z.string().trim().regex(/^\d{6,8}$/, 'Enter the 6–8 digit code') });
export const webauthnResponseBody = z.object({ response: z.object({ id: z.string(), rawId: z.string(), type: z.literal('public-key'), response: z.record(z.string(), z.any()) }).passthrough() });
export const credentialPatchBody = z.object({ isLoginFactor: z.boolean() });

export const adminUserPatch = z.object({ role: z.enum(['user', 'admin']).optional(), status: z.enum(['active', 'suspended']).optional() }).refine((v) => v.role || v.status, 'Nothing to update');
export const adminProtocolPatch = z.object({ status: z.enum(['active', 'disabled']).optional(), parameters: z.record(z.string(), z.any()).optional() }).refine((v) => v.status || v.parameters, 'Nothing to update');
export const auditQuery = z.object({
  action: z.string().max(80).optional(),
  userId: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25), q: z.string().max(100).optional() });
