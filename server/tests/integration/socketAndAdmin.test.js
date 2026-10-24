import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import { app, setupDb, teardownDb, loggedInAgent, waitForJob } from '../helpers/app.js';
import { initSocket, closeSocket } from '../../src/services/socketManager.js';
import { AuditLog, User, Protocol } from '../../src/models/index.js';
import { shutdownBenchmarks } from '../../src/services/benchmark/benchmarkService.js';

let a;
let server;
let base;
beforeAll(async () => {
  await setupDb();
  a = app();
  server = http.createServer(a);
  initSocket(server);
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
afterAll(async () => {
  await shutdownBenchmarks();
  await closeSocket();
  await new Promise((r) => server.close(r));
  await teardownDb();
});

const sessionCookie = async (username) => {
  const res = await request(a)
    .post('/api/auth/login')
    .send({ identifier: username, password: 'CorrectHorse#1' });
  return res.headers['set-cookie'].find((c) => c.startsWith('mfa_session=')).split(';')[0];
};
const connect = (cookie) =>
  new Promise((resolve, reject) => {
    const s = ioClient(base, {
      extraHeaders: cookie ? { Cookie: cookie } : {},
      transports: ['websocket'],
      reconnection: false,
    });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => {
      s.close();
      reject(e);
    });
  });

describe('Socket.IO real-time progress (FR7)', () => {
  it('rejects unauthenticated sockets', async () => {
    await expect(connect(null)).rejects.toThrow(/unauthorised/);
  });
  it("delivers the job's events in order to its owner only, while the API stays responsive", async () => {
    const { agent, user } = await loggedInAgent(a);
    const { user: other } = await loggedInAgent(a);
    const mine = await connect(await sessionCookie(user.username));
    const theirs = await connect(await sessionCookie(other.username));
    const seen = [];
    const leaked = [];
    for (const ev of [
      'job:started',
      'protocol:started',
      'iteration:progress',
      'protocol:completed',
      'job:completed',
    ]) {
      mine.on(ev, (p) => seen.push([ev, p]));
      theirs.on(ev, () => leaked.push(ev));
    }
    const { body } = await agent.post('/api/jobs').send({
      protocols: [{ name: 'HOTP' }, { name: 'TOTP' }],
      iterations: 3000,
      warmupIterations: 50,
      runSecuritySimulations: false,
    });
    // Performance NFR: benchmark runs in a worker, so API requests are served meanwhile.
    const t0 = Date.now();
    const health = await request(a).get('/api/health');
    expect(health.status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(1000);
    await waitForJob(agent, body.job._id);
    await new Promise((r) => setTimeout(r, 200));
    const names = seen.map(([e]) => e);
    expect(names[0]).toBe('job:started');
    expect(names.at(-1)).toBe('job:completed');
    expect(names.filter((n) => n === 'protocol:started')).toHaveLength(2);
    expect(names).toContain('iteration:progress');
    expect(seen.every(([, p]) => p.jobId === body.job._id)).toBe(true);
    expect(leaked).toEqual([]);
    mine.close();
    theirs.close();
  });
});

describe('Administrator (Figure 3.1: manage users, protocols, logs)', () => {
  it('lists and updates users, cannot modify self, and audits the change', async () => {
    const { agent: admin, user: me } = await loggedInAgent(a, { role: 'admin' });
    const { user: target } = await loggedInAgent(a);
    const list = await admin.get('/api/admin/users?q=' + target.username);
    expect(list.body.items[0]).toMatchObject({ username: target.username, jobCount: 0 });
    expect(list.body.items[0].passwordHash).toBeUndefined();
    expect(
      (await admin.patch(`/api/admin/users/${target._id}`).send({ status: 'suspended' })).body.user
        .status,
    ).toBe('suspended');
    expect((await admin.patch(`/api/admin/users/${me._id}`).send({ role: 'user' })).status).toBe(
      400,
    );
    expect((await admin.patch(`/api/admin/users/${target._id}`).send({})).status).toBe(400);
    expect(
      await AuditLog.exists({
        action: 'admin.user_updated',
        'details.targetUserId': String(target._id),
      }),
    ).toBeTruthy();
    expect((await User.findById(target._id)).status).toBe('suspended');
    expect((await admin.get('/api/admin/users?q=.*')).body.total).toBe(0); // regex input is escaped
  });
  it('updates protocol status and validated default parameters', async () => {
    const { agent: admin } = await loggedInAgent(a, { role: 'admin' });
    const p = await Protocol.findOne({ name: 'TOTP' });
    const ok = await admin
      .patch(`/api/admin/protocols/${p._id}`)
      .send({ parameters: { window: 2 } });
    expect(ok.status).toBe(200);
    expect(ok.body.protocol.defaultConfig.parameters).toContainEqual({
      name: 'window',
      value: 2,
      type: 'number',
    });
    expect(
      (await admin.patch(`/api/admin/protocols/${p._id}`).send({ parameters: { window: 99 } }))
        .status,
    ).toBe(400);
    expect(
      (await admin.patch(`/api/admin/protocols/${p._id}`).send({ status: 'disabled' })).body
        .protocol.status,
    ).toBe('disabled');
    await admin
      .patch(`/api/admin/protocols/${p._id}`)
      .send({ status: 'active', parameters: { window: 1 } });
  });
  it('queries audit logs by action prefix, and never stores secrets (FR11)', async () => {
    const { agent: admin } = await loggedInAgent(a, { role: 'admin' });
    const r = await admin.get('/api/admin/audit-logs?action=auth.');
    expect(r.body.items.length).toBeGreaterThan(0);
    expect(r.body.items.every((i) => i.action.startsWith('auth.'))).toBe(true);
    const all = JSON.stringify(await AuditLog.find().lean());
    expect(all).not.toMatch(/CorrectHorse/);
    expect(all).not.toMatch(/passwordHash/);
  });
  it('audit helper strips sensitive keys', async () => {
    const { audit } = await import('../../src/services/auditService.js');
    await audit(null, 'test.scrub', {
      code: '123456',
      nested: { password: 'p', ok: 1 },
      secretKey: 'x',
      keep: 'y',
    });
    const doc = await AuditLog.findOne({ action: 'test.scrub' }).lean();
    expect(doc.details).toEqual({ nested: { ok: 1 }, keep: 'y' });
  });
  it('system endpoints', async () => {
    const { agent } = await loggedInAgent(a);
    expect((await agent.get('/api/system/status')).body).toMatchObject({
      db: 'connected',
      benchmark: { running: [] },
    });
    expect((await agent.get('/api/literature/table-2-1')).body.label).toMatch(/not measured/);
    expect((await agent.get('/api/protocols')).body.items).toHaveLength(4);
    expect(Object.keys((await agent.get('/api/assessment/rubric')).body.rubric)).toEqual([
      'integration',
      'usability',
    ]);
  });
});
