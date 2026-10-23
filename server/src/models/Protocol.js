import mongoose from 'mongoose';

export const PROTOCOL_NAMES = ['HOTP', 'TOTP', 'OOB Email', 'WebAuthn'];

const parameterSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    value: { type: mongoose.Schema.Types.Mixed },
    type: { type: String, required: true },
  },
  { _id: false },
);

/** protocols collection (Chapter 3 §3.9.2, corrected `defaultConfig.parameters[].name` form). */
const protocolSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, enum: PROTOCOL_NAMES },
    version: { type: String, required: true },
    type: { type: String, required: true },
    defaultConfig: { parameters: { type: [parameterSchema], default: [] } },
    implementation: { type: mongoose.Schema.Types.Mixed, default: {} },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
  },
  { timestamps: true, collection: 'protocols', minimize: false },
);

export const Protocol = mongoose.models.Protocol ?? mongoose.model('Protocol', protocolSchema);
