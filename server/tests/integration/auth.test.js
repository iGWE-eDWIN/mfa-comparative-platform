import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, setupDb, teardownDb, loggedInAgent } from '../helpers/app.js';
import { User, AuditLog } from '../../src/models/index.js';
import { resetLockouts } from '../../src/services/authService.js';

let a;
beforeAll(async () => {
  await setupDb();
  a = app();
});
afterAll(teardownDb);
beforeEach(() => resetLockouts());

const reg = (o = {}) => ({
  username: 'alice',
  email: 'alice@example.test',
  password: 'long-enough-pw',
  confirmPassword: 'long-enough-pw',
  ...o,
});

describe('FR1 registration', () => {
  it('registers, hashes the password and sets a hardened session cookie', async () => {
    const res = await request(a).post('/api/auth/register').send(reg());
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ username: 'alice', role: 'user' });
    expect(res.body.user.passwordHash).toBeUndefined();
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('mfa_session='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const stored = await User.findOne({ username: 'alice' }).select('+passwordHash');
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(stored.passwordHash).not.toContain('long-enough-pw');
  });
  it('validates input', async () => {
    const res = await request(a)
      .post('/api/auth/register')
      .send(reg({ username: 'a', email: 'bad', password: 'short', confirmPassword: 'other' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d) => d.path);
    expect(paths).toEqual(
      expect.arrayContaining(['username', 'email', 'password', 'confirmPassword']),
    );
  });
  it('rejects duplicate username or email', async () => {
    expect(
      (
        await request(a)
          .post('/api/auth/register')
          .send(reg({ email: 'other@example.test' }))
      ).status,
    ).toBe(409);
    expect(
      (
        await request(a)
          .post('/api/auth/register')
          .send(reg({ username: 'bob' }))
      ).status,
    ).toBe(409);
  });
  it('requires JSON for state-changing requests (CSRF hardening)', async () => {
    const res = await request(a)
      .post('/api/auth/login')
      .type('form')
      .send('identifier=alice&password=x');
    expect(res.status).toBe(415);
  });
});

describe('FR1 login, session, logout', () => {
  it('logs in by username or email and reads /me', async () => {
    const agent = request.agent(a);
    expect(
      (
        await agent
          .post('/api/auth/login')
          .send({ identifier: 'alice', password: 'long-enough-pw' })
      ).status,
    ).toBe(200);
    expect((await agent.get('/api/auth/me')).body.user.username).toBe('alice');
    expect(
      (
        await request(a)
          .post('/api/auth/login')
          .send({ identifier: 'ALICE@example.test', password: 'long-enough-pw' })
      ).status,
    ).toBe(200);
    expect((await agent.post('/api/auth/logout')).status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
  it('gives the same error for unknown user and wrong password', async () => {
    const r1 = await request(a)
      .post('/api/auth/login')
      .send({ identifier: 'nobody', password: 'x' });
    const r2 = await request(a)
      .post('/api/auth/login')
      .send({ identifier: 'alice', password: 'wrong-password' });
    expect(r1.status).toBe(401);
    expect(r2.body.error).toEqual(r1.body.error);
  });
  it('locks the account identifier after 5 failures', async () => {
    for (let i = 0; i < 5; i++)
      await request(a).post('/api/auth/login').send({ identifier: 'alice', password: 'wrong' });
    const res = await request(a)
      .post('/api/auth/login')
      .send({ identifier: 'alice', password: 'long-enough-pw' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(await AuditLog.countDocuments({ action: 'auth.login_failed' })).toBeGreaterThanOrEqual(
      5,
    );
  });
  it('blocks suspended users, including existing sessions', async () => {
    const { agent, user } = await loggedInAgent(a);
    await User.updateOne({ _id: user._id }, { status: 'suspended' });
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    const res = await request(a)
      .post('/api/auth/login')
      .send({ identifier: user.username, password: 'CorrectHorse#1' });
    expect(res.status).toBe(403);
  });
  it('rejects forged or tampered session tokens', async () => {
    const res = await request(a)
      .get('/api/auth/me')
      .set('Cookie', 'mfa_session=eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.');
    expect(res.status).toBe(401);
  });
  it('protects routes and enforces roles', async () => {
    expect((await request(a).get('/api/jobs')).status).toBe(401);
    const { agent } = await loggedInAgent(a);
    expect((await agent.get('/api/admin/users')).status).toBe(403);
  });
  it('sets Helmet security headers and an error envelope for unknown routes', async () => {
    const res = await request(a).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
  it('allows only listed CORS origins', async () => {
    const ok = await request(a).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const bad = await request(a).get('/api/health').set('Origin', 'https://evil.example');
    expect(bad.status).toBe(403);
  });
});
