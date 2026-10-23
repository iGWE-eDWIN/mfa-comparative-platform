import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, setupDb, teardownDb, loggedInAgent, waitForJob } from '../helpers/app.js';
import { ComparisonJob, Protocol, Result } from '../../src/models/index.js';
import { startLocalSink, stopLocalSink } from '../../src/services/mail/localSink.js';
import { getMailer } from '../../src/services/mail/mailService.js';
import { shutdownBenchmarks } from '../../src/services/benchmark/benchmarkService.js';

let a;
beforeAll(async () => {
  await setupDb();
  await startLocalSink(0);
  a = app();
});
afterAll(async () => {
  await shutdownBenchmarks();
  getMailer().close();
  await stopLocalSink();
  await teardownDb();
});

const body = (o = {}) => ({
  protocols: [{ name: 'HOTP' }, { name: 'TOTP' }, { name: 'OOB Email' }],
  iterations: 25,
  warmupIterations: 5,
  runSecuritySimulations: true,
  label: 'integration',
  ...o,
});

describe('Comparison jobs (FR2, FR3, FR5, FR6, FR8, FR9)', () => {
  let agent;
  let jobId;
  beforeAll(async () => {
    ({ agent } = await loggedInAgent(a));
  });

  it('creates a Pending job with merged, validated parameters and environment metadata', async () => {
    const res = await agent
      .post('/api/jobs')
      .send(
        body({
          protocols: [
            { name: 'HOTP', config: { lookAheadWindow: 3 } },
            { name: 'TOTP' },
            { name: 'OOB Email' },
          ],
        }),
      );
    expect(res.status).toBe(202);
    const job = res.body.job;
    jobId = job._id;
    expect(job.status).toBe('Pending');
    expect(job.protocols[0]).toMatchObject({
      name: 'HOTP',
      config: { lookAheadWindow: 3, digits: 6, algorithm: 'SHA1' },
    });
    expect(job.protocols[0].protocolId).toBeTruthy();
    expect(job.settings).toMatchObject({ iterations: 25, warmupIterations: 5 });
    expect(job.environment).toMatchObject({
      node: process.version,
      isolation: expect.stringContaining('worker_threads'),
    });
    expect(job.environment.libraries.nodemailer).toBeTruthy();
  });

  it('runs to Completed and stores one result per protocol with every metric', async () => {
    const job = await waitForJob(agent, jobId);
    expect(job.status).toBe('Completed');
    expect(job.progress.percent).toBe(100);
    expect(job.startedAt && job.finishedAt).toBeTruthy();
    expect(job.environment.mail.provider).toBe('local');
    const r = await agent.get(`/api/jobs/${jobId}/results`);
    expect(r.body.results).toHaveLength(3);
    for (const res of r.body.results) {
      expect(res.metrics.latency).toMatchObject({ n: 25 });
      for (const k of ['mean', 'median', 'p95', 'p99', 'min', 'max', 'stdDev'])
        expect(typeof res.metrics.latency[k]).toBe('number');
      expect(res.metrics.throughput.opsPerSec).toBeGreaterThan(0);
      expect(res.metrics.errorRate).toBe(0);
      expect(res.metrics.rawSamples).toBeUndefined();
      expect(res.distributions.latency.length).toBeGreaterThan(0);
      expect(res.securityOutcome.replayTest.status).toBe('pass');
      expect(res.integrationAssessment.criteria.length).toBeGreaterThan(0);
      expect(res.hardwareRequirement).toBeTruthy();
      expect(res.channelDependency).toBeTruthy();
    }
    const oob = r.body.results.find((x) => x.protocolName === 'OOB Email');
    expect(oob.metrics.channel.sendTime.n).toBe(25);
    expect(oob.metrics.channel.provider).toBe('local');
    const raw = await Result.findOne({ jobId, protocolName: 'HOTP' }).lean();
    expect(raw.metrics.rawSamples.latency).toHaveLength(25);
    expect(raw.config.lookAheadWindow).toBe(3);
  });

  it('validates configuration (Figure 3.3 "Valid?")', async () => {
    const bad = [
      body({ protocols: [] }),
      body({ protocols: [{ name: 'SMS' }] }),
      body({ protocols: [{ name: 'HOTP' }, { name: 'HOTP' }] }),
      body({ iterations: 0 }),
      body({ protocols: [{ name: 'TOTP', config: { timeStep: 1 } }] }),
    ];
    for (const b of bad) {
      const res = await agent.post('/api/jobs').send(b);
      expect(res.status, JSON.stringify(b)).toBe(400);
    }
  });

  it('refuses protocols disabled by an administrator', async () => {
    await Protocol.updateOne({ name: 'TOTP' }, { status: 'disabled' });
    const res = await agent.post('/api/jobs').send(body({ protocols: [{ name: 'TOTP' }] }));
    expect(res.body.error.code).toBe('PROTOCOL_DISABLED');
    await Protocol.updateOne({ name: 'TOTP' }, { status: 'active' });
  });

  it("isolates users: other users' jobs are 404", async () => {
    const { agent: other } = await loggedInAgent(a);
    expect((await other.get(`/api/jobs/${jobId}`)).status).toBe(404);
    expect((await other.get(`/api/jobs/${jobId}/results`)).status).toBe(404);
    expect((await other.get(`/api/jobs/${jobId}/export?format=csv`)).status).toBe(404);
    expect((await other.get('/api/jobs')).body.total).toBe(0);
    const resultId = (await Result.findOne({ jobId }))._id;
    expect(
      (
        await other
          .patch(`/api/results/${resultId}/assessment`)
          .send({ usability: { observations: 'x' } })
      ).status,
    ).toBe(404);
  });

  it('exports CSV and JSON (FR10)', async () => {
    const csv = await agent.get(`/api/jobs/${jobId}/export?format=csv`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(
      /attachment; filename="?comparison-.*\.csv"?/,
    );
    expect(csv.text.trim().split('\r\n')).toHaveLength(4);
    const json = await agent.get(`/api/jobs/${jobId}/export?format=json`);
    const parsed = JSON.parse(json.text);
    expect(parsed.jobs[0].results[0].metrics.rawSamples.latency).toHaveLength(25);
    const slim = JSON.parse(
      (await agent.get(`/api/jobs/${jobId}/export?format=json&includeRaw=false`)).text,
    );
    expect(slim.jobs[0].results[0].metrics.rawSamples).toBeUndefined();
    const hist = await agent.get('/api/jobs/export?format=csv&status=Completed');
    expect(hist.text.split('\r\n')[0]).toMatch(/^jobId,/);
  });

  it('lists history with filters and pagination', async () => {
    const all = await agent.get('/api/jobs');
    expect(all.body.total).toBeGreaterThanOrEqual(1);
    expect((await agent.get('/api/jobs?status=Failed')).body.total).toBe(0);
    expect((await agent.get('/api/jobs?protocol=WebAuthn')).body.total).toBe(0);
    expect((await agent.get('/api/jobs?protocol=HOTP')).body.total).toBeGreaterThanOrEqual(1);
    expect((await agent.get('/api/jobs?from=2999-01-01')).body.total).toBe(0);
    expect((await agent.get('/api/jobs?status=Weird')).status).toBe(400);
    expect((await agent.get('/api/jobs/recent')).body.items.length).toBeGreaterThanOrEqual(1);
  });

  it('records usability and integration observations (FR12)', async () => {
    const resultId = (await Result.findOne({ jobId, protocolName: 'TOTP' }))._id;
    const res = await agent
      .patch(`/api/results/${resultId}/assessment`)
      .send({
        usability: { scores: { userSteps: 5 }, observations: 'Code typed in 6 s on average' },
      });
    expect(res.status).toBe(200);
    expect(res.body.usabilityAssessment.observations).toBe('Code typed in 6 s on average');
    expect(
      res.body.usabilityAssessment.criteria.find((c) => c.criterion === 'userSteps').score,
    ).toBe(5);
    expect(
      (
        await agent
          .patch(`/api/results/${resultId}/assessment`)
          .send({ usability: { scores: { userSteps: 9 } } })
      ).status,
    ).toBe(400);
  });
});

describe('Job state machine (Figure 3.4) and cancellation', () => {
  it('cancels a running job → Cancelled, and rejects cancelling a finished one', async () => {
    const { agent } = await loggedInAgent(a);
    const { body: b } = await agent
      .post('/api/jobs')
      .send({
        protocols: [{ name: 'HOTP' }],
        iterations: 10000,
        warmupIterations: 0,
        runSecuritySimulations: false,
      });
    const id = b.job._id;
    for (let i = 0; i < 100 && (await ComparisonJob.findById(id)).status !== 'Running'; i++)
      await new Promise((r) => setTimeout(r, 50));
    const c = await agent.post(`/api/jobs/${id}/cancel`);
    expect(c.status).toBe(200);
    const done = await waitForJob(agent, id);
    expect(done.status).toBe('Cancelled');
    expect(done.cancelRequested).toBe(true);
    expect((await agent.post(`/api/jobs/${id}/cancel`)).status).toBe(409);
  });
  it('a job exceeding its timeout ends Failed with a meaningful error', async () => {
    const { agent } = await loggedInAgent(a);
    const { body: b } = await agent
      .post('/api/jobs')
      .send({
        protocols: [{ name: 'OOB Email' }],
        iterations: 10000,
        warmupIterations: 0,
        timeoutMs: 1000,
        runSecuritySimulations: false,
      });
    const done = await waitForJob(agent, b.job._id);
    expect(done.status).toBe('Failed');
    expect(done.error).toMatch(/timeout of 1000 ms/);
  });
  it('rejects illegal transitions', async () => {
    const { transition } = await import('../../src/services/benchmark/benchmarkService.js');
    await expect(transition('000000000000000000000000', 'Completed', 'Running')).rejects.toThrow(
      /Illegal job transition/,
    );
  });
});
