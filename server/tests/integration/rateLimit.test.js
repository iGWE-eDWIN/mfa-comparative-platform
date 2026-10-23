import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

process.env.ENABLE_RATE_LIMITS = 'true';
const { app, setupDb, teardownDb } = await import('../helpers/app.js');

let a;
beforeAll(async () => {
  await setupDb();
  a = app();
});
afterAll(teardownDb);

describe('express-rate-limit on login', () => {
  it('returns 429 after 20 attempts in the window', async () => {
    let last;
    for (let i = 0; i < 21; i++)
      last = await request(a)
        .post('/api/auth/login')
        .send({ identifier: `x${i}`, password: 'nope' });
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe('RATE_LIMITED');
    expect(last.headers['ratelimit-policy'] ?? last.headers['ratelimit']).toBeDefined();
  });
});
