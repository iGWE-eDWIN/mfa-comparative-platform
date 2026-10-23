#!/usr/bin/env node
/**
 * No-Docker MongoDB for development: runs a real mongod binary (downloaded once by
 * mongodb-memory-server) with a persistent data directory at ./.mongo-data.
 * Usage: npm run dev:db   (keeps running; Ctrl+C to stop)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = path.join(root, '.mongo-data');
fs.mkdirSync(dbPath, { recursive: true });
const port = Number(process.env.DEV_MONGO_PORT ?? 27017);

const server = await MongoMemoryServer.create({ instance: { port, dbPath, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
console.log(`MongoDB ready at ${server.getUri()} (data: ${dbPath})`);
console.log('Set MONGODB_URI=mongodb://127.0.0.1:%d/mfa_platform in .env', port);
const stop = async () => {
  await server.stop({ doCleanup: false });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
