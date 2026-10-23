import mongoose from 'mongoose';

/**
 * otp_challenges collection — deliberate extension (D04).
 * Stores only HMAC-SHA-256(pepper, salt || code); expired documents are removed by the TTL index.
 */
const otpChallengeSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, enum: ['simulator', 'login'], default: 'simulator' },
    channel: { type: String, default: 'email' },
    destination: String,
    codeHash: { type: String, required: true, select: false },
    salt: { type: String, required: true, select: false },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    used: { type: Boolean, default: false },
    resendAvailableAt: Date,
    expiresAt: { type: Date, required: true },
    delivery: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: 'otp_challenges' },
);

otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpChallengeSchema.index({ userId: 1, purpose: 1, createdAt: -1 });

export const OtpChallenge =
  mongoose.models.OtpChallenge ?? mongoose.model('OtpChallenge', otpChallengeSchema);
