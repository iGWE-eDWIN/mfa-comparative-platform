import { OtpChallenge } from '../models/index.js';
import { keys } from './keys.js';
import { hashCode, newSalt, randomNumericCode, safeEqual } from '../lib/crypto.js';
import { getMailer } from './mail/mailService.js';
import { localInbox } from './mail/localSink.js';
import { HttpError } from '../middleware/errors.js';
import { audit } from './auditService.js';
import { env } from '../config/env.js';

export const OOB_POLICY = {
  codeDigits: 6,
  expirySeconds: 300,
  maxAttempts: 5,
  resendCooldownSeconds: 30,
};
const PREVIEW_PROVIDERS = ['ethereal', 'local'];

/**
 * Issue and email a one-time code. Generation/hashing time (server compute) and email send time
 * (provider/network) are measured and returned separately.
 */
export async function sendOobCode(user, purpose = 'simulator') {
  const now = Date.now();
  const recent = await OtpChallenge.findOne({
    userId: user.id,
    purpose,
    used: false,
    resendAvailableAt: { $gt: new Date(now) },
  })
    .sort({ createdAt: -1 })
    .lean();
  if (recent) {
    const retryAfter = Math.ceil((recent.resendAvailableAt - now) / 1000);
    throw new HttpError(
      429,
      `Please wait ${retryAfter} s before requesting another code`,
      'RESEND_COOLDOWN',
      { retryAfter },
    );
  }
  const genStart = process.hrtime.bigint();
  const code = randomNumericCode(OOB_POLICY.codeDigits);
  const salt = newSalt();
  const codeHash = hashCode(code, salt, keys.otpPepper);
  const generationTimeMs = Number(process.hrtime.bigint() - genStart) / 1e6;
  // Older unused codes for the same purpose are invalidated: only the newest code is valid.
  await OtpChallenge.updateMany(
    { userId: user.id, purpose, used: false },
    { $set: { used: true } },
  );
  const ch = await OtpChallenge.create({
    userId: user.id,
    purpose,
    destination: user.email,
    codeHash,
    salt,
    maxAttempts: OOB_POLICY.maxAttempts,
    expiresAt: new Date(now + OOB_POLICY.expirySeconds * 1000),
    resendAvailableAt: new Date(now + OOB_POLICY.resendCooldownSeconds * 1000),
  });
  const mailer = getMailer();
  const sendStart = process.hrtime.bigint();
  let delivery;
  try {
    const info = await mailer.init();
    const sent = await mailer.sendOtp({
      to: user.email,
      code,
      expiresInSeconds: OOB_POLICY.expirySeconds,
      purpose: purpose === 'login' ? 'sign-in' : 'verification',
    });
    const sendTimeMs = Number(process.hrtime.bigint() - sendStart) / 1e6;
    delivery = {
      provider: info.provider,
      tls: info.tls,
      sendTimeMs,
      messageId: sent.messageId,
      previewUrl: sent.previewUrl,
      fallbackReason: info.fallbackReason,
    };
  } catch (err) {
    await OtpChallenge.deleteOne({ _id: ch._id });
    await audit(user.id, 'oob.delivery_failed', { purpose, error: err.message });
    throw new HttpError(502, `Email delivery failed: ${err.message}`, 'DELIVERY_FAILED');
  }
  await OtpChallenge.updateOne({ _id: ch._id }, { $set: { delivery } });
  await audit(user.id, 'oob.code_sent', {
    purpose,
    provider: delivery.provider,
    sendTimeMs: delivery.sendTimeMs,
  });
  const showPreview = PREVIEW_PROVIDERS.includes(delivery.provider) && env.showTestInbox;
  return {
    challengeId: String(ch._id),
    destination: maskEmail(user.email),
    expiresAt: ch.expiresAt,
    resendAvailableAt: ch.resendAvailableAt,
    generationTimeMs,
    delivery: {
      provider: delivery.provider,
      tls: delivery.tls,
      sendTimeMs: delivery.sendTimeMs,
      previewUrl: showPreview ? delivery.previewUrl : null,
      fallbackReason: delivery.fallbackReason,
    },
  };
}

/** Verify a code: single use, expiry, attempt limit; constant-time comparison of HMACs. */
export async function verifyOobCode(user, challengeId, code, purpose = 'simulator') {
  const ch = await OtpChallenge.findOne({ _id: challengeId, userId: user.id, purpose }).select(
    '+codeHash +salt',
  );
  const start = process.hrtime.bigint();
  const ms = () => Number(process.hrtime.bigint() - start) / 1e6;
  const failWith = async (reason) => {
    await audit(user.id, 'oob.verify_failed', { purpose, reason });
    return { ok: false, reason, serverTimeMs: ms() };
  };
  if (!ch) return failWith('unknown_challenge');
  if (ch.used) return failWith('already_used');
  if (ch.expiresAt < new Date()) return failWith('expired');
  if (ch.attempts >= ch.maxAttempts) return failWith('attempts_exceeded');
  const ok = safeEqual(hashCode(String(code), ch.salt, keys.otpPepper), ch.codeHash);
  const serverTimeMs = ms();
  if (!ok) {
    await OtpChallenge.updateOne({ _id: ch._id }, { $inc: { attempts: 1 } });
    await audit(user.id, 'oob.verify_failed', {
      purpose,
      reason: 'invalid_code',
      attempts: ch.attempts + 1,
    });
    return {
      ok: false,
      reason: 'invalid_code',
      serverTimeMs,
      attemptsLeft: ch.maxAttempts - ch.attempts - 1,
    };
  }
  const won = await OtpChallenge.updateOne({ _id: ch._id, used: false }, { $set: { used: true } });
  if (won.modifiedCount === 0) return failWith('already_used');
  await audit(user.id, 'oob.verify_succeeded', { purpose });
  return { ok: true, serverTimeMs };
}

/** Development inbox for the local SMTP sink (in production only with MAIL_TEST_INBOX_IN_UI=true). */
export function devInbox(user) {
  if (!env.showTestInbox) throw new HttpError(404, 'Not available', 'NOT_FOUND');
  return localInbox(user.email).map((m) => ({
    id: m.id,
    receivedAt: m.receivedAt,
    secure: m.secure,
    text: extractText(m.raw),
  }));
}

function extractText(raw) {
  const body = raw
    .split(/\r?\n\r?\n/)
    .slice(1)
    .join('\n');
  const match = body.match(/Your one-time [\s\S]*?can be used once\./);
  return (match ? match[0] : body.slice(0, 400)).replace(/=\r?\n/g, '');
}

export function maskEmail(email) {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}
