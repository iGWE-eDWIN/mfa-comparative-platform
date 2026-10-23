/**
 * Common protocol interface (Chapter 3 §3.7.5). The Benchmark Service and the Security
 * Simulation Service drive every protocol only through these six operations.
 *
 * Transaction model (docs/DECISIONS.md D07/D08):
 *   execute() performs one authentication attempt up to the point where the server must
 *   decide: the server issues whatever it needs to issue (OOB code, WebAuthn challenge),
 *   the simulated claimant produces a response, and a `Transaction` is returned.
 *   verify(tx) is the server-side decision.
 * Both report `serverNs`: server-side compute only, measured with process.hrtime.bigint().
 *
 * @typedef {object} Transaction
 * @property {any} artifact          what the claimant submits (code, assertion)
 * @property {bigint} serverNs       server compute spent in execute (issuance)
 * @property {object} [meta]         protocol-specific observations (e.g. sendNs)
 *
 * @typedef {object} Verification
 * @property {boolean} ok
 * @property {string} [reason]       machine-readable failure reason
 * @property {bigint} serverNs
 * @property {object} [meta]
 *
 * @typedef {object} ModuleContext
 * @property {() => number} now      clock in ms (injectable so expiry/drift can be simulated)
 * @property {{ encryptionKey: Buffer, otpPepper: Buffer }} keys
 * @property {import('../services/mail/mailService.js').Mailer} [mailer]
 * @property {() => Promise<import('playwright-core').Browser>} [getBrowser]
 * @property {{ id: string, name: string, origin: string }} [rp]
 */
export class ProtocolModule {
  /** @type {string} */ static protocolName;
  /** @type {string} */ static version;
  /** @type {string} */ static type;
  /** @type {import('zod').ZodObject<any>} */ static schema;
  /** Static, literature- and design-derived descriptors stored in protocols.metadata. */
  static metadata = {};

  /** @param {ModuleContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.config = null;
    this.observations = {};
  }

  /** Validate and apply protocol-specific parameters (FR3). */
  configure(params = {}) {
    this.config = this.constructor.schema.parse(params);
    return this.config;
  }

  /** Provision the test identity (secret, account or credential). @returns {Promise<{ enrolmentNs: bigint }>} */
  async initialize() {
    throw new Error('not implemented');
  }

  /** @param {object} [_options] @returns {Promise<Transaction>} */
  async execute(_options) {
    throw new Error('not implemented');
  }

  /** @param {Transaction} _tx @returns {Promise<Verification>} */
  async verify(_tx) {
    throw new Error('not implemented');
  }

  /** Protocol-specific observations (counter state, drift, delivery). */
  collectMetrics() {
    return { ...this.observations };
  }

  /** Release resources and forget all state. */
  async reset() {
    this.observations = {};
  }

  /** Default parameter values, derived from the schema. */
  static defaults() {
    return this.schema.parse({});
  }
}

/** Uniform failure object so every protocol reports reasons the same way. */
export const fail = (reason, serverNs = 0n, meta = {}) => ({ ok: false, reason, serverNs, meta });
