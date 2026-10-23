import mongoose from 'mongoose';

/**
 * credentials collection — deliberate extension (docs/DECISIONS.md D04).
 * HOTP/TOTP secrets are stored only as AES-256-GCM ciphertext; WebAuthn stores the public key.
 */
const credentialSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    protocol: { type: String, enum: ['HOTP', 'TOTP', 'OOB Email', 'WebAuthn'], required: true },
    label: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'active', 'locked'], default: 'pending' },
    isLoginFactor: { type: Boolean, default: false },
    /** AES-256-GCM envelope {iv, tag, data} (base64) of the OTP shared secret. */
    encryptedSecret: { type: mongoose.Schema.Types.Mixed, select: false },
    otp: {
      algorithm: String,
      digits: Number,
      counter: Number,
      lookAheadWindow: Number,
      timeStep: Number,
      window: Number,
      lastUsedStep: Number,
      resyncCount: { type: Number, default: 0 },
    },
    webauthn: {
      credentialId: String,
      publicKey: String,
      signCount: Number,
      transports: [String],
      deviceType: String,
      backedUp: Boolean,
      aaguid: String,
    },
    failedAttempts: { type: Number, default: 0 },
    lockedUntil: Date,
    lastUsedAt: Date,
  },
  { timestamps: true, collection: 'credentials' },
);

credentialSchema.index({ userId: 1, protocol: 1 });
credentialSchema.index({ 'webauthn.credentialId': 1 }, { unique: true, sparse: true });

export const Credential = mongoose.models.Credential ?? mongoose.model('Credential', credentialSchema);
