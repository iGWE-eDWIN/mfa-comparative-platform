import mongoose from 'mongoose';

export const JOB_STATUSES = ['Pending', 'Running', 'Completed', 'Failed', 'Cancelled'];
export const TERMINAL_STATUSES = ['Completed', 'Failed', 'Cancelled'];

/**
 * Allowed transitions of the comparison-job state machine (Chapter 3, Figure 3.4).
 * Pending may also be cancelled before it starts (a user cancelling a queued job).
 */
export const JOB_TRANSITIONS = {
  Pending: ['Running', 'Cancelled'],
  Running: ['Completed', 'Failed', 'Cancelled'],
  Completed: [],
  Failed: [],
  Cancelled: [],
};

const jobProtocolSchema = new mongoose.Schema(
  {
    protocolId: { type: mongoose.Schema.Types.ObjectId, ref: 'Protocol', required: true },
    name: { type: String, required: true },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['Pending', 'Running', 'Completed', 'Failed', 'Skipped'],
      default: 'Pending',
    },
  },
  { _id: false, minimize: false },
);

/** comparison_jobs collection (Chapter 3 §3.9.1, §3.9.3). */
const jobSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    protocols: { type: [jobProtocolSchema], validate: (v) => v.length > 0 },
    settings: {
      iterations: { type: Number, required: true },
      warmupIterations: { type: Number, default: 0 },
      timeoutMs: { type: Number, required: true },
      operationTimeoutMs: { type: Number, default: 15000 },
      runSecuritySimulations: { type: Boolean, default: true },
      label: { type: String, default: '' },
    },
    status: { type: String, enum: JOB_STATUSES, default: 'Pending' },
    progress: {
      percent: { type: Number, default: 0 },
      currentProtocol: { type: String, default: null },
      phase: { type: String, default: null },
      completedIterations: { type: Number, default: 0 },
      totalIterations: { type: Number, default: 0 },
    },
    environment: { type: mongoose.Schema.Types.Mixed, default: {} },
    error: { type: String, default: null },
    cancelRequested: { type: Boolean, default: false },
    startedAt: Date,
    finishedAt: Date,
  },
  { timestamps: true, collection: 'comparison_jobs', minimize: false },
);

// Chapter 3 §3.9.4 indexes.
jobSchema.index({ userId: 1 });
jobSchema.index({ status: 1 });
jobSchema.index({ createdAt: -1 });
jobSchema.index({ 'protocols.protocolId': 1 });

export const ComparisonJob =
  mongoose.models.ComparisonJob ?? mongoose.model('ComparisonJob', jobSchema);
