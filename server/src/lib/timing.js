/**
 * High-resolution timing helpers (process.hrtime.bigint, monotonic, ns resolution).
 */

/**
 * Run `fn` and return its result plus elapsed nanoseconds.
 * @template T
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<{ result: T, ns: bigint }>}
 */
export async function timed(fn) {
  const start = process.hrtime.bigint();
  const result = await fn();
  return { result, ns: process.hrtime.bigint() - start };
}

/** Synchronous variant for pure-compute operations, so no microtask hop is measured. */
export function timedSync(fn) {
  const start = process.hrtime.bigint();
  const result = fn();
  return { result, ns: process.hrtime.bigint() - start };
}

/** Reject after `ms` with a TimeoutError-coded error. */
export function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms} ms`);
      err.code = 'ETIMEDOUT';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
