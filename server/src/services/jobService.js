import { ComparisonJob, Protocol, Result } from '../models/index.js';
import { validateParams } from '../protocols/ProtocolManager.js';
import { collectEnvironment } from './environmentService.js';
import { enqueue, cancelJob as cancelRunning } from './benchmark/benchmarkService.js';
import { audit } from './auditService.js';
import { HttpError } from '../middleware/errors.js';
import { env } from '../config/env.js';
import { histogram } from '../lib/stats.js';

/** Merge protocol defaults (protocols.defaultConfig) with the user's parameters and validate (FR3). */
async function resolveProtocols(selected) {
  const docs = await Protocol.find({ name: { $in: selected.map((p) => p.name) } }).lean();
  return selected.map(({ name, config }) => {
    const doc = docs.find((d) => d.name === name);
    if (!doc) throw new HttpError(400, `Protocol ${name} is not installed (run the seed script)`, 'PROTOCOL_MISSING');
    if (doc.status !== 'active') throw new HttpError(400, `Protocol ${name} is disabled by an administrator`, 'PROTOCOL_DISABLED');
    const defaults = Object.fromEntries((doc.defaultConfig?.parameters ?? []).map((p) => [p.name, p.value]));
    let validated;
    try {
      validated = validateParams(name, { ...defaults, ...config });
    } catch (err) {
      throw new HttpError(400, `Invalid parameters for ${name}`, 'VALIDATION_ERROR', err.issues?.map((i) => ({ path: `${name}.${i.path.join('.')}`, message: i.message })));
    }
    return { protocolId: doc._id, name, config: validated, status: 'Pending' };
  });
}

export async function createJob(user, body) {
  const protocols = await resolveProtocols(body.protocols);
  if (env.MAIL_PROVIDER === 'brevo' && protocols.some((p) => p.name === 'OOB Email' && p.config.sendEmail)) {
    const sends = body.iterations + body.warmupIterations + 10;
    if (sends > env.BREVO_MAX_BENCH_EMAILS) throw new HttpError(400, `Brevo free tier: this job would send about ${sends} emails (limit ${env.BREVO_MAX_BENCH_EMAILS}). Lower the iterations or use MAIL_PROVIDER=ethereal/local for large runs.`, 'BREVO_LIMIT');
  }
  const job = await ComparisonJob.create({
    userId: user.id,
    protocols,
    settings: { iterations: body.iterations, warmupIterations: body.warmupIterations, timeoutMs: body.timeoutMs, operationTimeoutMs: body.operationTimeoutMs, runSecuritySimulations: body.runSecuritySimulations, label: body.label },
    status: 'Pending',
    progress: { percent: 0, totalIterations: body.iterations },
    environment: collectEnvironment({ mailProviderConfigured: env.MAIL_PROVIDER, webauthnOrigin: env.WEBAUTHN_ORIGIN, webauthnRpId: env.WEBAUTHN_RP_ID, benchmarkConcurrency: env.BENCHMARK_CONCURRENCY, isolation: 'worker_threads (one worker per job)' }),
  });
  await audit(user.id, 'job.created', { jobId: String(job._id), protocols: protocols.map((p) => p.name), iterations: body.iterations });
  enqueue(job._id);
  return job;
}

/** Load a job the caller owns; 404 (not 403) for other users' jobs so ids cannot be probed. */
export async function getOwnedJob(user, id) {
  const job = await ComparisonJob.findOne({ _id: id, userId: user.id });
  if (!job) throw new HttpError(404, 'Job not found', 'NOT_FOUND');
  return job;
}

export async function listJobs(user, q) {
  const filter = { userId: user.id };
  if (q.status) filter.status = q.status;
  if (q.protocol) filter['protocols.name'] = q.protocol;
  if (q.from || q.to) filter.createdAt = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  const [items, total] = await Promise.all([
    ComparisonJob.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).select('-environment').lean(),
    ComparisonJob.countDocuments(filter),
  ]);
  return { items, total, page: q.page, limit: q.limit };
}

export async function cancel(user, id) {
  const job = await getOwnedJob(user, id);
  const updated = await cancelRunning(job);
  if (!updated) throw new HttpError(409, `A ${job.status} job cannot be cancelled`, 'INVALID_STATE');
  await audit(user.id, 'job.cancel_requested', { jobId: id, previousStatus: job.status });
  return updated;
}

/** Results for one job, without raw samples but with histograms for the distribution chart (FR9). */
export async function jobResults(job) {
  const results = await Result.find({ jobId: job._id }).lean();
  return results.map((r) => {
    const { rawSamples, ...metrics } = r.metrics;
    return { ...r, metrics, distributions: { latency: histogram(rawSamples?.latency ?? []), processing: histogram(rawSamples?.processing ?? []) } };
  });
}

export async function recentJobs(user, limit = 5) {
  return ComparisonJob.find({ userId: user.id }).sort({ createdAt: -1 }).limit(limit).select('status protocols.name settings.iterations settings.label progress.percent createdAt finishedAt error').lean();
}
