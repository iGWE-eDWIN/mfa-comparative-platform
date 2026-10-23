import { parentPort, workerData } from 'node:worker_threads';
import { runBenchmark } from './runner.js';
import { keys } from '../keys.js';
import { Mailer } from '../mail/mailService.js';
import { launchBrowser } from '../../lib/virtualAuthenticator.js';

/**
 * Benchmark worker thread (Performance NFR, docs/DECISIONS.md D19). One worker per job, so
 * measurement loops never share an event loop with API requests.
 */
const { protocols, settings, mailProvider, rp } = workerData;
let cancelled = false;
parentPort.on('message', (msg) => {
  if (msg?.type === 'cancel') cancelled = true;
});

const needsMail = protocols.some((p) => p.name === 'OOB Email');
const mailer = needsMail
  ? new Mailer({ provider: mailProvider, startSink: false, fallbackLocal: false })
  : null;
let browserPromise = null;
const getBrowser = () => (browserPromise ??= launchBrowser());

const makeCtx = (clock = { offsetMs: 0 }) => ({
  now: () => Date.now() + clock.offsetMs,
  keys,
  mailer,
  getBrowser,
  rp,
});

const emit = (event, payload) => parentPort.postMessage({ type: 'event', event, payload });

try {
  const { results, interrupted } = await runBenchmark({
    protocols,
    settings,
    makeCtx,
    emit,
    isCancelled: () => cancelled,
  });
  let browserVersion = null;
  if (browserPromise) {
    const b = await browserPromise;
    browserVersion = b.version();
    await b.close();
  }
  parentPort.postMessage({
    type: 'done',
    results,
    browserVersion,
    mailInfo: mailer?.info ?? null,
    interrupted: interrupted ? { code: interrupted.code, message: interrupted.message } : null,
  });
} catch (err) {
  parentPort.postMessage({
    type: 'fatal',
    error: { message: err.message, code: err.code ?? null },
  });
} finally {
  mailer?.close();
  if (browserPromise) await (await browserPromise.catch(() => null))?.close().catch(() => {});
}
