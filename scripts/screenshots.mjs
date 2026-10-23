#!/usr/bin/env node
/* global document -- waitForFunction callbacks run in the browser */
/**
 * Drives the real UI in headless Chromium and saves screenshots (used for Chapter 4 figures).
 * Prerequisite: API serving the built client (SERVE_CLIENT=true), seeded database.
 * Usage: node scripts/screenshots.mjs [baseUrl] [outDir] [--iterations=N] [--job=<id>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const { resolveChromium } = await import('../server/src/lib/virtualAuthenticator.js');

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const [base = 'http://localhost:4000', out = 'docs/screenshots'] = args.filter((a) => !a.startsWith('--'));
fs.mkdirSync(out, { recursive: true });
const iterations = Number(flags.iterations ?? 100);

const browser = await chromium.launch({ headless: true, executablePath: resolveChromium() });
const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: flags.dark ? 'dark' : 'light' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const shot = async (name, full = false) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: full });
  console.log('saved', name);
};

await page.goto(`${base}/login`);
await shot('01-login');
await page.getByLabel('Username or email').fill(flags.user ?? 'demo');
await page.getByLabel('Password', { exact: true }).fill(flags.password ?? 'DemoPass#2026');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
await page.getByText('Database').waitFor();
await shot('02-dashboard');

let jobId = flags.job;
if (!jobId) {
  await page.getByRole('link', { name: 'New comparison' }).first().click();
  await page.getByRole('heading', { name: 'New comparison' }).waitFor();
  await page.getByLabel('Iterations', { exact: true }).fill(String(iterations));
  await page.getByLabel('Warm-up iterations').fill(String(Math.min(20, iterations)));
  await page.getByLabel('Label (optional)').fill('UI walkthrough');
  await page.locator('details summary').first().click();
  await shot('03-configure', true);
  await page.getByRole('button', { name: 'Run Comparison' }).click();
  await page.getByRole('heading', { name: 'Live benchmark' }).waitFor();
  jobId = page.url().split('/jobs/')[1].split('/')[0];
  await page.waitForFunction(() => document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') > 5, null, { timeout: 120000 });
  await shot('04-monitor-running');
  await page.getByRole('button', { name: 'View results' }).waitFor({ timeout: 30 * 60 * 1000 });
  await shot('05-monitor-complete');
}
await page.goto(`${base}/jobs/${jobId}/results`);
await page.getByRole('heading', { name: 'Side-by-side comparison' }).waitFor();
await shot('06-results-full', true);
await page.getByRole('heading', { name: 'Security matrix' }).scrollIntoViewIfNeeded();
await shot('07-security-matrix');
await page.goto(`${base}/history`);
await page.getByRole('table').waitFor();
await shot('08-history');
await page.goto(`${base}/simulators/totp`);
await page.getByRole('button', { name: 'Enrol TOTP' }).click();
await page.locator('.token').waitFor();
const code = (await page.locator('.token').textContent()).trim();
await page.getByLabel('One-time code').fill(code);
await page.getByRole('button', { name: 'Verify' }).click();
await page.getByText('accepted').waitFor();
await page.getByLabel('One-time code').fill(code);
await page.getByRole('button', { name: 'Verify' }).click();
await page.getByText('replayed_code').waitFor();
await shot('09-simulator-totp', true);
await page.goto(`${base}/simulators/oob`);
await page.getByRole('button', { name: 'Send code' }).click();
await page.getByText('Email send time').waitFor({ timeout: 30000 });
await shot('10-simulator-oob', true);

if (flags.admin !== 'false') {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByLabel('Username or email').fill('admin');
  await page.getByLabel('Password', { exact: true }).fill(flags.adminPassword ?? 'AdminPass#2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
  await page.goto(`${base}/admin/audit`);
  await page.getByRole('table').waitFor();
  await shot('11-admin-audit');
  await page.goto(`${base}/admin/protocols`);
  await page.getByRole('heading', { name: 'Protocols', exact: true }).waitFor();
  await shot('12-admin-protocols');
}
console.log(JSON.stringify({ jobId, consoleErrors: errors }));
await browser.close();
