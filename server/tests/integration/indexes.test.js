import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { setupDb, teardownDb } from '../helpers/app.js';

beforeAll(setupDb);
afterAll(teardownDb);

const keysOf = async (coll) =>
  (await mongoose.connection.collection(coll).indexes()).map((i) => ({
    key: i.key,
    unique: Boolean(i.unique),
    ttl: i.expireAfterSeconds,
  }));

describe('Chapter 3 §3.9.4 indexes', () => {
  it.each([
    ['users', { username: 1 }, true],
    ['users', { email: 1 }, true],
    ['protocols', { name: 1 }, true],
    ['comparison_jobs', { userId: 1 }, false],
    ['comparison_jobs', { status: 1 }, false],
    ['comparison_jobs', { createdAt: -1 }, false],
    ['comparison_jobs', { 'protocols.protocolId': 1 }, false],
    ['results', { jobId: 1 }, false],
    ['results', { protocolId: 1 }, false],
    ['audit_logs', { userId: 1 }, false],
    ['audit_logs', { timestamp: -1 }, false],
  ])('%s %j (unique=%s)', async (coll, key, unique) => {
    const idx = await keysOf(coll);
    expect(idx).toContainEqual(expect.objectContaining({ key, unique }));
  });
  it('TTL indexes on the extension collections (D04)', async () => {
    expect(await keysOf('otp_challenges')).toContainEqual(
      expect.objectContaining({ key: { expiresAt: 1 }, ttl: 0 }),
    );
    expect(await keysOf('webauthn_challenges')).toContainEqual(
      expect.objectContaining({ key: { expiresAt: 1 }, ttl: 0 }),
    );
  });
  it('seeded protocols collection has the four protocols with default parameters', async () => {
    const docs = await mongoose.connection.collection('protocols').find().toArray();
    expect(docs.map((d) => d.name).sort()).toEqual(['HOTP', 'OOB Email', 'TOTP', 'WebAuthn']);
    for (const d of docs) {
      expect(d.defaultConfig.parameters.length).toBeGreaterThan(3);
      expect(d.defaultConfig.parameters[0]).toEqual(
        expect.objectContaining({ name: expect.any(String), type: expect.any(String) }),
      );
      expect(d.implementation.interface).toEqual([
        'configure',
        'initialize',
        'execute',
        'verify',
        'collectMetrics',
        'reset',
      ]);
    }
  });
});

describe('Seed recovery switch', () => {
  it('SEED_RESET_PASSWORDS re-applies the env password to existing seed accounts', async () => {
    const { seed } = await import('../../scripts/seed.js');
    const { User } = await import('../../src/models/index.js');
    const bcrypt = (await import('bcryptjs')).default;
    const logs = [];
    process.env.SEED_ADMIN_PASSWORD = 'first-admin-password';
    await seed({ log: (m) => logs.push(m) }); // admin already exists from setup: unchanged
    let admin = await User.findOne({ username: 'admin' }).select('+passwordHash');
    expect(await bcrypt.compare('first-admin-password', admin.passwordHash)).toBe(false);
    expect(logs.some((l) => l.includes('password unchanged'))).toBe(true);

    process.env.SEED_RESET_PASSWORDS = 'true';
    process.env.SEED_ADMIN_PASSWORD = ' spaced-password ';
    await seed({ log: (m) => logs.push(m) });
    admin = await User.findOne({ username: 'admin' }).select('+passwordHash');
    expect(await bcrypt.compare(' spaced-password ', admin.passwordHash)).toBe(true);
    expect(logs.some((l) => l.includes('leading/trailing spaces'))).toBe(true);
    expect(logs.some((l) => l.includes('password reset from SEED_ADMIN_PASSWORD'))).toBe(true);
    delete process.env.SEED_RESET_PASSWORDS;
    delete process.env.SEED_ADMIN_PASSWORD;
  });
});
