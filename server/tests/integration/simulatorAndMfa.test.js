import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app, setupDb, teardownDb, loggedInAgent } from '../helpers/app.js';
import { base32Decode } from '../../src/lib/base32.js';
import { hotp, totp } from '../../src/lib/otp.js';
import { Credential, OtpChallenge, AuditLog } from '../../src/models/index.js';
import { startLocalSink, stopLocalSink, localInbox } from '../../src/services/mail/localSink.js';
import { getMailer } from '../../src/services/mail/mailService.js';

let a;
beforeAll(async () => {
  await setupDb();
  await startLocalSink(0);
  a = app();
});
afterAll(async () => {
  getMailer().close();
  await stopLocalSink();
  await teardownDb();
});

const codeFromInbox = (email) => localInbox(email)[0]?.raw.match(/code is[\s\S]*?(\d{6})/)?.[1];

describe('HOTP simulator (FR4)', () => {
  it('enrols with QR, stores the secret encrypted, verifies and rejects replay', async () => {
    const { agent, user } = await loggedInAgent(a);
    const e = await agent.post('/api/simulator/otp/hotp/enrol').send({ config: {} });
    expect(e.status).toBe(201);
    expect(e.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(e.body.otpauthUri).toMatch(/^otpauth:\/\/hotp\//);
    const raw = await mongoose.connection.collection('credentials').findOne({ userId: user._id });
    expect(JSON.stringify(raw)).not.toContain(e.body.secretBase32);
    expect(raw.encryptedSecret).toHaveProperty('tag');
    const secret = base32Decode(e.body.secretBase32);
    const code = hotp(secret, 0);
    const v = await agent
      .post(`/api/simulator/otp/credentials/${e.body.credentialId}/verify`)
      .send({ code });
    expect(v.body).toMatchObject({ ok: true, drift: 0, activated: true });
    expect(v.body.serverTimeMs).toBeGreaterThan(0);
    expect(
      (
        await agent
          .post(`/api/simulator/otp/credentials/${e.body.credentialId}/verify`)
          .send({ code })
      ).body.ok,
    ).toBe(false);
    expect(
      (
        await agent
          .post(`/api/simulator/otp/credentials/${e.body.credentialId}/verify`)
          .send({ code: hotp(secret, 5) })
      ).body,
    ).toMatchObject({ ok: true, drift: 4 });
    expect((await Credential.findById(e.body.credentialId)).otp.resyncCount).toBe(1);
  });
  it('locks after 5 failed attempts', async () => {
    const { agent } = await loggedInAgent(a);
    const e = await agent.post('/api/simulator/otp/hotp/enrol').send({ config: {} });
    const secret = base32Decode(e.body.secretBase32);
    const wrong = String((Number(hotp(secret, 0)) + 1) % 1e6).padStart(6, '0');
    for (let i = 0; i < 5; i++)
      await agent
        .post(`/api/simulator/otp/credentials/${e.body.credentialId}/verify`)
        .send({ code: wrong });
    const r = await agent
      .post(`/api/simulator/otp/credentials/${e.body.credentialId}/verify`)
      .send({ code: hotp(secret, 0) });
    expect(r.body.reason).toBe('locked');
  });
  it("cannot use another user's credential", async () => {
    const { agent } = await loggedInAgent(a);
    const { agent: other } = await loggedInAgent(a);
    const e = await agent.post('/api/simulator/otp/totp/enrol').send({ config: {} });
    expect(
      (
        await other
          .post(`/api/simulator/otp/credentials/${e.body.credentialId}/verify`)
          .send({ code: '123456' })
      ).status,
    ).toBe(404);
  });
  it('validates code format and protocol name', async () => {
    const { agent } = await loggedInAgent(a);
    expect((await agent.post('/api/simulator/otp/sms/enrol').send({ config: {} })).status).toBe(
      400,
    );
    expect(
      (
        await agent
          .post('/api/simulator/otp/credentials/000000000000000000000000/verify')
          .send({ code: 'abc' })
      ).status,
    ).toBe(400);
  });
});

describe('OOB Email simulator (FR4)', () => {
  it('sends a real SMTP message over STARTTLS, stores only a hash, verifies once', async () => {
    const { agent, user } = await loggedInAgent(a);
    const s = await agent.post('/api/simulator/oob/send');
    expect(s.status).toBe(200);
    expect(s.body.delivery).toMatchObject({ provider: 'local' });
    expect(s.body.delivery.sendTimeMs).toBeGreaterThan(0);
    expect(s.body.generationTimeMs).toBeGreaterThan(0);
    expect(s.body.destination).not.toBe(user.email);
    const msg = localInbox(user.email)[0];
    expect(msg.secure).toBe(true);
    const code = codeFromInbox(user.email);
    const raw = await mongoose.connection
      .collection('otp_challenges')
      .findOne({ userId: user._id });
    expect(raw.codeHash).toBeTruthy();
    expect(JSON.stringify(raw)).not.toContain(`"${code}"`);
    expect(
      (
        await agent
          .post('/api/simulator/oob/verify')
          .send({ challengeId: s.body.challengeId, code })
      ).body.ok,
    ).toBe(true);
    expect(
      (
        await agent
          .post('/api/simulator/oob/verify')
          .send({ challengeId: s.body.challengeId, code })
      ).body.reason,
    ).toBe('already_used');
    expect(
      await Credential.exists({ userId: user._id, protocol: 'OOB Email', status: 'active' }),
    ).toBeTruthy();
    const inbox = await agent.get('/api/simulator/oob/inbox');
    expect(inbox.body.messages[0].text).toContain('expires in 5 minute');
  });
  it('enforces resend cooldown, attempt limit and expiry', async () => {
    const { agent, user } = await loggedInAgent(a);
    const s = await agent.post('/api/simulator/oob/send');
    const again = await agent.post('/api/simulator/oob/send');
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe('RESEND_COOLDOWN');
    const code = codeFromInbox(user.email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      await agent
        .post('/api/simulator/oob/verify')
        .send({ challengeId: s.body.challengeId, code: wrong });
    expect(
      (
        await agent
          .post('/api/simulator/oob/verify')
          .send({ challengeId: s.body.challengeId, code })
      ).body.reason,
    ).toBe('attempts_exceeded');
    await OtpChallenge.updateMany(
      { userId: user._id },
      { $set: { resendAvailableAt: new Date(0) } },
    );
    const s2 = await agent.post('/api/simulator/oob/send');
    await OtpChallenge.updateOne(
      { _id: s2.body.challengeId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    expect(
      (
        await agent
          .post('/api/simulator/oob/verify')
          .send({ challengeId: s2.body.challengeId, code: codeFromInbox(user.email) })
      ).body.reason,
    ).toBe('expired');
  });
});

describe('Second factor at login (D13)', () => {
  it('TOTP login factor: password → mfa_pending → code → session', async () => {
    const { agent, user, password } = await loggedInAgent(a);
    const e = await agent.post('/api/simulator/otp/totp/enrol').send({ config: {} });
    const secret = base32Decode(e.body.secretBase32);
    const now = Math.floor(Date.now() / 1000);
    await agent
      .post(`/api/simulator/otp/credentials/${e.body.credentialId}/verify`)
      .send({ code: totp(secret, now - 30) });
    expect(
      (await agent.patch(`/api/credentials/${e.body.credentialId}`).send({ isLoginFactor: true }))
        .status,
    ).toBe(200);

    const fresh = request.agent(a);
    const l = await fresh.post('/api/auth/login').send({ identifier: user.username, password });
    expect(l.body).toEqual({ mfaRequired: true, method: 'TOTP' });
    expect((await fresh.get('/api/auth/me')).status).toBe(401);
    expect(
      (
        await fresh
          .post('/api/auth/mfa/verify')
          .send({ code: '000000' === totp(secret, now) ? '111111' : '000000' })
      ).status,
    ).toBe(401);
    const ok = await fresh
      .post('/api/auth/mfa/verify')
      .send({ code: totp(secret, Math.floor(Date.now() / 1000)) });
    expect(ok.status).toBe(200);
    expect((await fresh.get('/api/auth/me')).body.user.id).toBe(String(user._id));
    expect(
      await AuditLog.exists({
        userId: user._id,
        action: 'auth.login_succeeded',
        'details.method': 'password+TOTP',
      }),
    ).toBeTruthy();
  });
  it('OOB Email login factor', async () => {
    const { agent, user, password } = await loggedInAgent(a);
    const s = await agent.post('/api/simulator/oob/send');
    await agent
      .post('/api/simulator/oob/verify')
      .send({ challengeId: s.body.challengeId, code: codeFromInbox(user.email) });
    const cred = await Credential.findOne({ userId: user._id, protocol: 'OOB Email' });
    await agent.patch(`/api/credentials/${cred._id}`).send({ isLoginFactor: true });
    const fresh = request.agent(a);
    expect(
      (await fresh.post('/api/auth/login').send({ identifier: user.username, password })).body
        .method,
    ).toBe('OOB Email');
    const sent = await fresh.post('/api/auth/mfa/oob/send');
    expect(sent.status).toBe(200);
    const ok = await fresh
      .post('/api/auth/mfa/verify')
      .send({ challengeId: sent.body.challengeId, code: codeFromInbox(user.email) });
    expect(ok.status).toBe(200);
    // A simulator challenge cannot be used for login (purpose separation).
    await OtpChallenge.updateMany({}, { $set: { resendAvailableAt: new Date(0) } });
    const simSend = await agent.post('/api/simulator/oob/send');
    const again = request.agent(a);
    await again.post('/api/auth/login').send({ identifier: user.username, password });
    expect(
      (
        await again
          .post('/api/auth/mfa/verify')
          .send({ challengeId: simSend.body.challengeId, code: codeFromInbox(user.email) })
      ).status,
    ).toBe(401);
  });
  it('mfa endpoints need a pending second-factor session', async () => {
    expect((await request(a).post('/api/auth/mfa/verify').send({ code: '123456' })).status).toBe(
      401,
    );
  });
  it('login factor must be active; credentials can be listed and deleted', async () => {
    const { agent } = await loggedInAgent(a);
    const e = await agent.post('/api/simulator/otp/hotp/enrol').send({ config: {} });
    expect(
      (await agent.patch(`/api/credentials/${e.body.credentialId}`).send({ isLoginFactor: true }))
        .status,
    ).toBe(400);
    expect((await agent.get('/api/credentials')).body.items).toHaveLength(1);
    expect((await agent.delete(`/api/credentials/${e.body.credentialId}`)).status).toBe(204);
    expect((await agent.delete(`/api/credentials/${e.body.credentialId}`)).status).toBe(404);
  });
});
