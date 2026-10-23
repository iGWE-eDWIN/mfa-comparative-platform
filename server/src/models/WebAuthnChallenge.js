import mongoose from 'mongoose';

/** webauthn_challenges collection — deliberate extension (D04). Single-use, TTL-expired. */
const challengeSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ceremony: { type: String, enum: ['registration', 'authentication'], required: true },
    purpose: { type: String, enum: ['simulator', 'login'], default: 'simulator' },
    challenge: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'webauthn_challenges' },
);

challengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
challengeSchema.index({ userId: 1, ceremony: 1 });

export const WebAuthnChallenge =
  mongoose.models.WebAuthnChallenge ?? mongoose.model('WebAuthnChallenge', challengeSchema);
