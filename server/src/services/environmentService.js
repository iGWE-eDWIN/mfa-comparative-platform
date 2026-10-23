import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';

const require = createRequire(import.meta.url);
const LIBS = [
  '@simplewebauthn/server',
  '@simplewebauthn/browser',
  'nodemailer',
  'mongoose',
  'express',
  'socket.io',
  'playwright-core',
  'zod',
  'bcryptjs',
];

function libVersion(name) {
  try {
    // Walk up from the resolved entry point to the package's own package.json.
    let dir = path.dirname(require.resolve(name));
    while (dir !== path.dirname(dir)) {
      const pj = path.join(dir, 'package.json');
      if (fs.existsSync(pj)) {
        const json = JSON.parse(fs.readFileSync(pj, 'utf8'));
        if (json.name === name) return json.version;
      }
      dir = path.dirname(dir);
    }
  } catch {
    // not installed
  }
  return null;
}

/** Environment metadata stored with every comparison job (Reproducibility NFR, §3.9.3). */
export function collectEnvironment(extra = {}) {
  const cpus = os.cpus();
  return {
    capturedAt: new Date().toISOString(),
    node: process.version,
    v8: process.versions.v8,
    openssl: process.versions.openssl,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    osType: os.type(),
    cpuModel: cpus[0]?.model ?? 'unknown',
    cpuCount: cpus.length,
    cpuSpeedMHz: cpus[0]?.speed ?? null,
    totalMemoryMB: Math.round(os.totalmem() / 2 ** 20),
    freeMemoryMB: Math.round(os.freemem() / 2 ** 20),
    loadAverage: os.loadavg(),
    mongodb: mongoose.connection?.readyState === 1 ? { database: mongoose.connection.name } : null,
    libraries: Object.fromEntries(LIBS.map((l) => [l, libVersion(l)])),
    hostname: os.hostname(),
    ...extra,
  };
}
