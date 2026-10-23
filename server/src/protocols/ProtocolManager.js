import { HotpModule } from './hotp/index.js';
import { TotpModule } from './totp/index.js';
import { OobEmailModule } from './oobEmail/index.js';
import { WebAuthnModule } from './webauthn/index.js';

/**
 * Protocol Manager (Chapter 3 §3.6.2): registry of protocol modules behind the common interface.
 * Adding a protocol means adding one module class here (Maintainability / Scalability NFRs).
 */
export const REGISTRY = {
  HOTP: HotpModule,
  TOTP: TotpModule,
  'OOB Email': OobEmailModule,
  WebAuthn: WebAuthnModule,
};

export const protocolNames = () => Object.keys(REGISTRY);

export function getModuleClass(name) {
  const M = REGISTRY[name];
  if (!M) {
    const err = new Error(`Unknown protocol: ${name}`);
    err.status = 400;
    throw err;
  }
  return M;
}

/** Create and configure a module instance. */
export function createModule(name, ctx, params = {}) {
  const M = getModuleClass(name);
  const m = new M(ctx);
  m.configure(params);
  return m;
}

/** Validate parameters without instantiating (used by the API before a job is queued). */
export function validateParams(name, params = {}) {
  return getModuleClass(name).schema.parse(params);
}

/** Parameter descriptors for the protocols collection: defaultConfig.parameters[] {name, value, type}. */
export function defaultParameters(name) {
  const M = getModuleClass(name);
  const defaults = M.defaults();
  return Object.entries(defaults).map(([key, value]) => ({ name: key, value, type: typeof value }));
}
