#!/usr/bin/env node
/**
 * One command for local development without Docker:
 *   MongoDB (unless MONGODB_URI already answers) + API (watch mode) + Vite client.
 * Ctrl+C stops everything.
 */
import net from 'node:net';
import { spawn } from 'node:child_process';

const children = [];
const run = (name, cmd, args, colour) => {
  const child = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  const tag = `\x1b[${colour}m[${name}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (d) => process.stdout.write(d.toString().replace(/^(?=.)/gm, tag)));
  child.on('exit', (code) => console.log(`${tag}exited (${code})`));
  children.push(child);
  return child;
};

const portOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
  });

if (!(await portOpen(27017))) {
  run('db', 'node', ['scripts/dev-mongo.mjs'], 33);
  for (let i = 0; i < 120 && !(await portOpen(27017)); i++)
    await new Promise((r) => setTimeout(r, 1000));
}
run('api', 'npm', ['run', 'dev', '-w', 'server'], 36);
run('web', 'npm', ['run', 'dev', '-w', 'client'], 35);
console.log(
  '\nOpen http://localhost:5173  (demo / DemoPass#2026, admin / AdminPass#2026 after `npm run seed`)\n',
);
const stop = () => {
  children.forEach((c) => c.kill('SIGINT'));
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
