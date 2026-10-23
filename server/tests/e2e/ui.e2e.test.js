import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import { chromium } from 'playwright-core';
import { start } from '../../src/server.js';
import { seed } from '../../scripts/seed.js';
import { resolveChromium } from '../../src/lib/virtualAuthenticator.js';

const BASE = 'http://localhost:4555';
const dist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../client/dist/index.html',
);
let app;
let browser;

beforeAll(async () => {
  if (!fs.existsSync(dist)) throw new Error('Build the client first: npm run build');
  app = await start({ port: 4555, mongoUri: `${inject('mongoUri').replace(/\/$/, '')}/e2e_ui` });
  await seed({ log: () => {} });
  browser = await chromium.launch({ headless: true, executablePath: resolveChromium() });
});
afterAll(async () => {
  await browser?.close();
  await app?.stop();
});

async function withVirtualAuthenticator(context, page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

describe('E2E: WebAuthn through the real UI with a virtual authenticator', () => {
  it('register account → passkey → passkey as login factor → sign in with password + passkey', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await withVirtualAuthenticator(context, page);

    await page.goto(`${BASE}/register`);
    await page.getByLabel('Username').fill('e2euser');
    await page.getByLabel('Email').fill('e2e@example.test');
    await page.getByLabel('Password', { exact: true }).fill('e2e-password-long');
    await page.getByLabel('Confirm password').fill('e2e-password-long');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('heading', { name: 'Dashboard' }).waitFor();

    await page.goto(`${BASE}/simulators/webauthn`);
    await page.getByRole('button', { name: 'Register a credential' }).click();
    await page.getByRole('cell', { name: 'Registration' }).waitFor();
    await page.getByRole('button', { name: 'Authenticate', exact: true }).click();
    await page.getByRole('cell', { name: 'Authentication' }).waitFor();
    expect(await page.locator('tbody tr').count()).toBe(2);
    expect(await page.locator('tbody').textContent()).not.toContain('✕');

    await page.goto(`${BASE}/credentials`);
    await page.getByRole('checkbox').first().click();
    await page.getByText('Required at sign-in').waitFor();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByLabel('Username or email').fill('e2euser');
    await page.getByLabel('Password', { exact: true }).fill('e2e-password-long');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('heading', { name: 'Second factor' }).waitFor();
    await page.getByRole('button', { name: /passkey/ }).click();
    // Returns to the page the user was on before signing out.
    await page.getByRole('heading', { name: 'My factors' }).waitFor();
    const me = await page.request.get(`${BASE}/api/auth/me`);
    expect((await me.json()).user.username).toBe('e2euser');
    expect(errors).toEqual([]);
    await context.close();
  });

  it('runs a four-protocol comparison from the UI and shows live progress and results', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE}/login`);
    await page.getByLabel('Username or email').fill('demo');
    await page.getByLabel('Password', { exact: true }).fill('DemoPass#2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('link', { name: 'New comparison' }).first().click();
    await page.getByLabel('Iterations', { exact: true }).fill('20');
    await page.getByLabel('Warm-up iterations').fill('2');
    await page.getByRole('button', { name: 'Run Comparison' }).click();
    await page.getByText('Live via Socket.IO').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'View results' }).waitFor({ timeout: 150000 });
    await page.getByRole('button', { name: 'View results' }).click();
    await page.getByRole('heading', { name: 'Side-by-side comparison' }).waitFor();
    const header = await page.locator('table').first().locator('thead').textContent();
    for (const p of ['HOTP', 'TOTP', 'OOB Email', 'WebAuthn']) expect(header).toContain(p);
    await page.getByRole('heading', { name: 'Security matrix' }).waitFor();
    expect(await page.getByText('From literature (Table 2.1) — not measured').count()).toBe(1);
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Export CSV' }).click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
    await context.close();
  });
});
