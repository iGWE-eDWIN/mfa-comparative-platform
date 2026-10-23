import mongoose from 'mongoose';

/** audit_logs collection (Chapter 3 §3.9.1). */
const auditSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: Date.now },
  },
  { collection: 'audit_logs', versionKey: false, minimize: false },
);

auditSchema.index({ userId: 1 });
auditSchema.index({ timestamp: -1 });

export const AuditLog = mongoose.models.AuditLog ?? mongoose.model('AuditLog', auditSchema);
