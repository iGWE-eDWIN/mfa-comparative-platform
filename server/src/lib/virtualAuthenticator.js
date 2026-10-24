/* global window -- functions passed to page.evaluate() run in the browser */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { env } from '../config/env.js';

const require = createRequire(import.meta.url);
const SWA_BUNDLE = fs.readFileSync(
  require
    .resolve('@simplewebauthn/browser')
    .replace(/script[\\/]index\.js$/, 'dist/bundle/index.umd.min.js'),
  'utf8',
);
const HARNESS_PATH = '/__mfa_webauthn/harness.html';
const HARNESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>WebAuthn harness</title>
<script src="/__mfa_webauthn/swa.js"></script></head><body>WebAuthn ceremony harness</body></html>`;

const SYSTEM_BROWSERS = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

/** Resolve a Chromium executable: CHROMIUM_PATH → Playwright-managed Chromium → system Chrome/Chromium. */
export function resolveChromium() {
  if (env.CHROMIUM_PATH) return env.CHROMIUM_PATH;
  try {
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch {
    // Playwright browsers not installed.
  }
  const found = SYSTEM_BROWSERS.find((p) => fs.existsSync(p));
  if (!found) throw new Error('No Chromium found: run `npm run browsers` or set CHROMIUM_PATH');
  return found;
}

// --disable-dev-shm-usage: containers (Docker, Render) often have a 64 MB /dev/shm that crashes Chromium.
export async function launchBrowser() {
  return chromium.launch({
    headless: true,
    executablePath: resolveChromium(),
    args: ['--no-first-run', '--disable-gpu', '--disable-dev-shm-usage'],
  });
}

/**
 * A browser tab with a CDP virtual authenticator (WebAuthn.addVirtualAuthenticator).
 * The ceremony page is served by request interception at any origin we choose, so the
 * browser applies its real origin / RP ID checks without a running web server.
 */
export class VirtualAuthenticatorSession {
  /** @param {import('playwright-core').Browser} browser */
  constructor(browser, options = {}) {
    this.browser = browser;
    this.authenticatorOptions = {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      ...options,
    };
    this.currentOrigin = null;
  }

  async open(origin) {
    this.context = await this.browser.newContext();
    await this.context.route('**/__mfa_webauthn/**', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/swa.js'))
        return route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          body: SWA_BUNDLE,
        });
      return route.fulfill({ status: 200, contentType: 'text/html', body: HARNESS_HTML });
    });
    this.page = await this.context.newPage();
    this.cdp = await this.context.newCDPSession(this.page);
    await this.cdp.send('WebAuthn.enable');
    const { authenticatorId } = await this.cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: this.authenticatorOptions,
    });
    this.authenticatorId = authenticatorId;
    await this.goto(origin);
    return this;
  }

  /** Navigate the same tab (and therefore the same virtual authenticator) to another origin. */
  async goto(origin) {
    if (this.currentOrigin === origin) return;
    await this.page.goto(new URL(HARNESS_PATH, origin).toString());
    await this.page.waitForFunction(() => Boolean(window.SimpleWebAuthnBrowser));
    this.currentOrigin = origin;
  }

  /** navigator.credentials.create() via @simplewebauthn/browser. */
  register(optionsJSON) {
    return this.page.evaluate(
      (o) => window.SimpleWebAuthnBrowser.startRegistration({ optionsJSON: o }),
      optionsJSON,
    );
  }

  /** navigator.credentials.get() via @simplewebauthn/browser. Errors are returned, not thrown. */
  authenticate(optionsJSON) {
    return this.page.evaluate(async (o) => {
      try {
        return {
          response: await window.SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: o }),
        };
      } catch (e) {
        return { error: { name: e.name, code: e.code ?? null, message: e.message } };
      }
    }, optionsJSON);
  }

  async credentials() {
    const { credentials } = await this.cdp.send('WebAuthn.getCredentials', {
      authenticatorId: this.authenticatorId,
    });
    return credentials;
  }

  async close() {
    await this.context?.close().catch(() => {});
    this.context = null;
  }
}
