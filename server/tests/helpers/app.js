import crypto from 'node:crypto';
import { inject } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { connectDb } from '../../src/config/db.js';
import { createApp } from '../../src/app.js';
import { seed } from '../../scripts/seed.js';
import { User } from '../../src/models/index.js';
import { hashPassword } from '../../src/services/authService.js';

/** Connect to a fresh, uniquely named database and seed it. */
export async function setupDb() {
  const uri = inject('mongoUri');
  const dbName = `t_${crypto.randomBytes(5).toString('hex')}`;
  await connectDb(`${uri.replace(/\/$/, '')}/${dbName}`);
  await seed({ log: () => {} });
  return dbName;
}

export async function teardownDb() {
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
}

export const app = () => createApp();

/** Create a user directly and return a supertest agent holding its session cookie. */
export async function loggedInAgent(
  appInstance,
  {
    username = `u${crypto.randomBytes(3).toString('hex')}`,
    role = 'user',
    password = 'CorrectHorse#1',
  } = {},
) {
  const user = await User.create({
    username,
    email: `${username}@example.test`,
    role,
    passwordHash: await hashPassword(password),
  });
  const agent = request.agent(appInstance);
  const res = await agent.post('/api/auth/login').send({ identifier: username, password });
  if (res.status !== 200)
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user, password };
}

/** Poll until a job reaches a terminal state. */
export async function waitForJob(agent, id, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = await agent.get(`/api/jobs/${id}`);
    if (['Completed', 'Failed', 'Cancelled'].includes(r.body.job?.status)) return r.body.job;
    await new Promise((res) => setTimeout(res, 150));
  }
  throw new Error('job did not finish in time');
}
