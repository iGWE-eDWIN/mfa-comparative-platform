import mongoose from 'mongoose';

const testOutcome = {
  status: { type: String, enum: ['pass', 'fail', 'not-applicable', 'error'] },
  explanation: String,
  evidence: { type: mongoose.Schema.Types.Mixed },
};

/** results collection (Chapter 3 §3.9.1, §3.9.3). One document per protocol per job. */
const resultSchema = new mongoose.Schema(
  {
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'ComparisonJob', required: true },
    protocolId: { type: mongoose.Schema.Types.ObjectId, ref: 'Protocol', required: true },
    protocolName: { type: String, required: true },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    metrics: {
      processingTime: { type: mongoose.Schema.Types.Mixed },
      latency: { type: mongoose.Schema.Types.Mixed },
      throughput: { type: mongoose.Schema.Types.Mixed },
      errorCount: Number,
      errorRate: Number,
      attempted: Number,
      resources: { type: mongoose.Schema.Types.Mixed },
      serverVerifyTime: { type: mongoose.Schema.Types.Mixed },
      channel: { type: mongoose.Schema.Types.Mixed },
      enrolmentTimeMs: Number,
      protocolObservations: { type: mongoose.Schema.Types.Mixed },
      errors: { type: [mongoose.Schema.Types.Mixed], default: [] },
      rawSamples: { type: mongoose.Schema.Types.Mixed },
    },
    securityOutcome: {
      phishingTest: testOutcome,
      replayTest: testOutcome,
      desynchronisationObservation: testOutcome,
      bruteForceTest: testOutcome,
      expiredCodeTest: testOutcome,
      securityNotes: { type: [String], default: [] },
    },
    integrationAssessment: { type: mongoose.Schema.Types.Mixed, default: {} },
    usabilityAssessment: { type: mongoose.Schema.Types.Mixed, default: {} },
    hardwareRequirement: String,
    channelDependency: String,
  },
  { timestamps: true, collection: 'results', minimize: false },
);

resultSchema.index({ jobId: 1 });
resultSchema.index({ protocolId: 1 });

export const Result = mongoose.models.Result ?? mongoose.model('Result', resultSchema);
