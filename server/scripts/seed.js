import { connectDb, disconnectDb } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { User, Protocol } from '../src/models/index.js';
import { REGISTRY, defaultParameters } from '../src/protocols/ProtocolManager.js';
import { hashPassword } from '../src/services/authService.js';
import { measureIntegration } from '../src/services/assessmentService.js';

/**
 * Seed: administrator, demo user and the protocols collection with default configurations.
 * Idempotent: existing users keep their passwords; protocol definitions are refreshed.
 */
export async function seed({ log = console.log } = {}) {
  const accounts = [
    {
      username: process.env.SEED_ADMIN_USERNAME ?? 'admin',
      email: process.env.SEED_ADMIN_EMAIL ?? 'admin@mfa-platform.test',
      password: process.env.SEED_ADMIN_PASSWORD,
      role: 'admin',
    },
    {
      username: process.env.SEED_DEMO_USERNAME ?? 'demo',
      email: process.env.SEED_DEMO_EMAIL ?? 'demo@mfa-platform.test',
      password: process.env.SEED_DEMO_PASSWORD,
      role: 'user',
    },
  ];
  for (const a of accounts) {
    if (!a.password) {
      if (env.NODE_ENV === 'production')
        throw new Error(
          `Set SEED_${a.role === 'admin' ? 'ADMIN' : 'DEMO'}_PASSWORD for production seeding`,
        );
      a.password = a.role === 'admin' ? 'AdminPass#2026' : 'DemoPass#2026';
    }
    const varName = `SEED_${a.role === 'admin' ? 'ADMIN' : 'DEMO'}_PASSWORD`;
    if (a.password !== a.password.trim()) {
      log(`! warning: ${varName} has leading/trailing spaces; they are part of the password`);
    }
    const existing = await User.findOne({ username: a.username });
    if (existing) {
      // Recovery switch: SEED_RESET_PASSWORDS=true re-applies the env passwords to existing seed
      // accounts (and re-activates them). Remove the variable again after signing in.
      if (['1', 'true', 'yes'].includes(String(process.env.SEED_RESET_PASSWORDS).toLowerCase())) {
        existing.passwordHash = await hashPassword(a.password);
        existing.status = 'active';
        await existing.save();
        log(`~ user ${a.username} password reset from ${varName}`);
      } else {
        log(
          `= user ${a.username} exists (${existing.role}); password unchanged (set SEED_RESET_PASSWORDS=true to reset)`,
        );
      }
      continue;
    }
    await User.create({
      username: a.username,
      email: a.email,
      role: a.role,
      passwordHash: await hashPassword(a.password),
    });
    log(
      `+ user ${a.username} (${a.role}) password: ${env.NODE_ENV === 'production' ? '[from env]' : a.password}`,
    );
  }
  for (const [name, M] of Object.entries(REGISTRY)) {
    const measured = measureIntegration(name);
    await Protocol.updateOne(
      { name },
      {
        $set: {
          version: M.version,
          type: M.type,
          implementation: {
            module: M.name,
            files: M.metadata.implementationFiles,
            dependencies: M.metadata.dependencies,
            linesOfCode: measured.linesOfCode,
            interface: ['configure', 'initialize', 'execute', 'verify', 'collectMetrics', 'reset'],
          },
          metadata: {
            standard: M.metadata.standard,
            factor: M.metadata.factor,
            hardwareRequirement: M.metadata.hardwareRequirement,
            channelDependency: M.metadata.channelDependency,
          },
        },
        // Administrators may have tuned defaults; only set them the first time.
        $setOnInsert: {
          name,
          status: 'active',
          'defaultConfig.parameters': defaultParameters(name),
        },
      },
      { upsert: true },
    );
    log(`~ protocol ${name}`);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  await connectDb();
  await seed();
  await disconnectDb();
}
