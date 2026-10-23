import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { ComparisonJob, JOB_TRANSITIONS, Result } from '../../models/index.js';
import { emitToUser } from '../socketManager.js';
import { audit } from '../auditService.js';
import { initialAssessments } from '../assessmentService.js';
import { getMailer } from '../mail/mailService.js';

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'worker.js');
const queue = [];
/** @type {Map<string, { worker: Worker, userId: string, killTimer?: NodeJS.Timeout }>} */
const running = new Map();

/**
 * Apply a state transition only if Figure 3.4 allows it. The update is conditional on the
 * current status, so two concurrent transitions cannot both succeed.
 */
export async function transition(jobId, from, to, set = {}) {
  if (!JOB_TRANSITIONS[from]?.includes(to))
    throw new Error(`Illegal job transition ${from} → ${to}`);
  return ComparisonJob.findOneAndUpdate(
    { _id: jobId, status: from },
    { $set: { status: to, ...set } },
    { new: true },
  );
}

export function enqueue(jobId) {
  queue.push(String(jobId));
  setImmediate(pump);
}

function pump() {
  while (running.size < env.BENCHMARK_CONCURRENCY && queue.length) {
    const id = queue.shift();
    start(id).catch((err) => logger.error({ err, jobId: id }, 'failed to start job'));
  }
}

async function start(jobId) {
  const job = await transition(jobId, 'Pending', 'Running', {
    startedAt: new Date(),
    'progress.phase': 'initialising',
  });
  if (!job) return pump(); // cancelled while queued
  const userId = String(job.userId);
  const emit = (event, payload) =>
    emitToUser(userId, event, { jobId: String(job._id), ...payload });
  emit('job:started', { protocols: job.protocols.map((p) => p.name), settings: job.settings });

  let mailProvider = env.MAIL_PROVIDER;
  if (job.protocols.some((p) => p.name === 'OOB Email')) {
    // Resolve once on the API thread (it owns the local sink; Ethereal fallback is decided here).
    const info = await getMailer()
      .init()
      .catch(() => null);
    if (info) mailProvider = info.provider;
  }

  const worker = new Worker(WORKER, {
    workerData: {
      protocols: job.protocols.map((p) => ({ name: p.name, config: p.config })),
      settings: {
        iterations: job.settings.iterations,
        warmupIterations: job.settings.warmupIterations,
        timeoutMs: job.settings.timeoutMs,
        operationTimeoutMs: job.settings.operationTimeoutMs,
        runSecuritySimulations: job.settings.runSecuritySimulations,
      },
      mailProvider,
      rp: { id: env.WEBAUTHN_RP_ID, name: env.WEBAUTHN_RP_NAME, origin: env.WEBAUTHN_ORIGIN },
    },
  });
  running.set(String(job._id), { worker, userId });

  let lastWrite = 0;
  let finished = false;
  worker.on('message', async (msg) => {
    if (msg.type === 'event') {
      const { event, payload } = msg;
      emit(event, payload);
      const now = Date.now();
      if (
        event === 'protocol:started' ||
        event === 'protocol:completed' ||
        now - lastWrite > 1000
      ) {
        lastWrite = now;
        const set = {
          'progress.currentProtocol': payload.protocol,
          'progress.phase': payload.phase ?? event,
        };
        if (payload.percent !== undefined) set['progress.percent'] = payload.percent;
        if (event === 'protocol:started') set[`protocols.${payload.index}.status`] = 'Running';
        if (event === 'protocol:completed')
          set[`protocols.${payload.index}.status`] = payload.failed ? 'Failed' : 'Completed';
        if (payload.phase === 'measure') {
          set['progress.completedIterations'] = payload.iteration;
          set['progress.totalIterations'] = payload.of;
        }
        await ComparisonJob.updateOne({ _id: job._id }, { $set: set }).catch(() => {});
      }
    } else if (msg.type === 'done' || msg.type === 'fatal') {
      finished = true;
      await finish(job, msg, emit).catch((err) => logger.error({ err }, 'failed to finalise job'));
    }
  });
  worker.on('error', async (err) => {
    if (finished) return;
    finished = true;
    await finish(job, { type: 'fatal', error: { message: err.message } }, emit).catch(() => {});
  });
  worker.on('exit', async (code) => {
    const entry = running.get(String(job._id));
    clearTimeout(entry?.killTimer);
    running.delete(String(job._id));
    if (!finished) {
      finished = true;
      const cancelled = (await ComparisonJob.findById(job._id))?.cancelRequested;
      await finish(
        job,
        cancelled
          ? {
              type: 'done',
              results: [],
              interrupted: {
                code: 'CANCELLED',
                message: 'Job cancelled by user (worker terminated)',
              },
            }
          : {
              type: 'fatal',
              error: { message: `Benchmark worker exited unexpectedly (code ${code})` },
            },
        emit,
      ).catch(() => {});
    }
    pump();
  });
}

async function finish(job, msg, emit) {
  const results = msg.results ?? [];
  const completed = results.filter((r) => r.status === 'Completed');
  const docs = completed.map((r) => {
    const p = job.protocols.find((x) => x.name === r.protocolName);
    return {
      jobId: job._id,
      protocolId: p.protocolId,
      protocolName: r.protocolName,
      config: r.config,
      metrics: r.metrics,
      securityOutcome: r.securityOutcome ?? undefined,
      hardwareRequirement: r.hardwareRequirement,
      channelDependency: r.channelDependency,
      ...initialAssessments(r.protocolName),
    };
  });
  if (docs.length) await Result.insertMany(docs);

  const envExtra = {
    'environment.browser': msg.browserVersion ?? null,
    'environment.mail': msg.mailInfo
      ? {
          provider: msg.mailInfo.provider,
          host: msg.mailInfo.host,
          tls: msg.mailInfo.tls,
          fallbackReason: msg.mailInfo.fallbackReason,
        }
      : null,
  };
  const base = { finishedAt: new Date(), ...envExtra };
  const failedProtocols = results.filter((r) => r.status === 'Failed');
  let to;
  let error = null;
  if (msg.type === 'fatal') {
    to = 'Failed';
    error = msg.error.message;
  } else if (msg.interrupted?.code === 'CANCELLED') {
    to = 'Cancelled';
  } else if (msg.interrupted) {
    to = 'Failed';
    error = msg.interrupted.message;
  } else if (failedProtocols.length) {
    to = 'Failed';
    error = failedProtocols.map((r) => `${r.protocolName}: ${r.error}`).join('; ');
  } else {
    to = 'Completed';
  }
  const set = { ...base, error, 'progress.phase': to.toLowerCase() };
  if (to === 'Completed')
    Object.assign(set, {
      'progress.percent': 100,
      'progress.completedIterations': job.settings.iterations,
      'progress.totalIterations': job.settings.iterations,
    });
  const updated = await transition(job._id, 'Running', to, set);
  const payload = { status: to, error, resultCount: docs.length };
  emit(
    to === 'Completed' ? 'job:completed' : to === 'Cancelled' ? 'job:cancelled' : 'job:failed',
    payload,
  );
  await audit(job.userId, `job.${to.toLowerCase()}`, {
    jobId: String(job._id),
    protocols: job.protocols.map((p) => p.name),
    error,
  });
  return updated;
}

/** Cancel a Pending or Running job owned by the caller (FR state Cancelled). */
export async function cancelJob(job) {
  const id = String(job._id);
  if (job.status === 'Pending') {
    const idx = queue.indexOf(id);
    if (idx >= 0) queue.splice(idx, 1);
    const updated = await transition(id, 'Pending', 'Cancelled', {
      finishedAt: new Date(),
      cancelRequested: true,
    });
    if (updated)
      emitToUser(String(job.userId), 'job:cancelled', { jobId: id, status: 'Cancelled' });
    return updated;
  }
  if (job.status === 'Running') {
    await ComparisonJob.updateOne({ _id: id }, { $set: { cancelRequested: true } });
    const entry = running.get(id);
    if (entry) {
      entry.worker.postMessage({ type: 'cancel' });
      // A protocol stuck in a long operation is terminated after 10 s.
      entry.killTimer = setTimeout(() => entry.worker.terminate(), 10000);
    }
    return ComparisonJob.findById(id);
  }
  return null;
}

/** On boot: jobs left Running by a previous process failed; Pending ones are queued again. */
export async function recoverJobs() {
  await ComparisonJob.updateMany(
    { status: 'Running' },
    {
      $set: {
        status: 'Failed',
        error: 'Server restarted while the job was running',
        finishedAt: new Date(),
      },
    },
  );
  const pending = await ComparisonJob.find({ status: 'Pending' })
    .sort({ createdAt: 1 })
    .select('_id');
  pending.forEach((j) => enqueue(j._id));
}

export const benchmarkState = () => ({ running: [...running.keys()], queued: [...queue] });

export async function shutdownBenchmarks() {
  await Promise.all([...running.values()].map((e) => e.worker.terminate()));
}
