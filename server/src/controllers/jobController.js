import * as jobs from '../services/jobService.js';
import { toCsv, toJson } from '../services/exportService.js';
import { ComparisonJob, Result } from '../models/index.js';
import { audit } from '../services/auditService.js';

export async function create(req, res) {
  const job = await jobs.createJob(req.user, req.body);
  res.status(202).json({ job });
}

export async function list(req, res) {
  res.json(await jobs.listJobs(req.user, req.validQuery));
}

export async function get(req, res) {
  res.json({ job: await jobs.getOwnedJob(req.user, req.params.id) });
}

export async function results(req, res) {
  const job = await jobs.getOwnedJob(req.user, req.params.id);
  res.json({ job, results: await jobs.jobResults(job) });
}

export async function cancel(req, res) {
  res.json({ job: await jobs.cancel(req.user, req.params.id) });
}

function send(res, rows, { format, includeRaw }, name) {
  if (format === 'csv') {
    res.type('text/csv').attachment(`${name}.csv`).send(toCsv(rows));
  } else {
    res
      .type('application/json')
      .attachment(`${name}.json`)
      .send(JSON.stringify(toJson(rows, includeRaw === 'true'), null, 2));
  }
}

export async function exportOne(req, res) {
  const job = await jobs.getOwnedJob(req.user, req.params.id);
  const results = await Result.find({ jobId: job._id }).lean();
  await audit(req.user.id, 'job.exported', {
    jobId: String(job._id),
    format: req.validQuery.format,
  });
  send(res, [{ job: job.toObject(), results }], req.validQuery, `comparison-${job._id}`);
}

/** Export the caller's history (optionally filtered) in one file. */
export async function exportHistory(req, res) {
  const q = { ...req.validQuery };
  const filter = { userId: req.user.id };
  if (q.status) filter.status = q.status;
  if (q.protocol) filter['protocols.name'] = q.protocol;
  const list = await ComparisonJob.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  const all = await Result.find({ jobId: { $in: list.map((j) => j._id) } }).lean();
  const rows = list.map((job) => ({
    job,
    results: all.filter((r) => String(r.jobId) === String(job._id)),
  }));
  await audit(req.user.id, 'history.exported', { format: q.format, jobs: list.length });
  send(res, rows, q, 'comparison-history');
}

export async function recent(req, res) {
  res.json({ items: await jobs.recentJobs(req.user) });
}
