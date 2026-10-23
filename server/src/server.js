import http from 'node:http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDb, disconnectDb } from './config/db.js';
import { createApp } from './app.js';
import { initSocket, closeSocket } from './services/socketManager.js';
import { recoverJobs, shutdownBenchmarks } from './services/benchmark/benchmarkService.js';
import { getMailer } from './services/mail/mailService.js';
import { startLocalSink, stopLocalSink } from './services/mail/localSink.js';

export async function start({ port = env.PORT, mongoUri } = {}) {
  await connectDb(mongoUri);
  if (['local', 'ethereal'].includes(env.MAIL_PROVIDER)) await startLocalSink();
  // Resolve the provider at boot (Ethereal account creation or fallback) so the first OTP is not delayed.
  getMailer().init().then(
    (info) => logger.info({ provider: info.provider, fallback: info.fallbackReason }, 'Mail provider ready'),
    (err) => logger.warn({ err: err.message }, 'Mail provider not ready; OOB Email will report an error until configured'),
  );
  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);
  await recoverJobs();
  await new Promise((resolve) => server.listen(port, resolve));
  logger.info({ port: server.address().port }, 'API listening');

  const stop = async () => {
    await shutdownBenchmarks();
    await closeSocket();
    await new Promise((r) => server.close(r));
    getMailer().close();
    await stopLocalSink();
    await disconnectDb();
  };
  return { server, app, stop };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { stop } = await start().catch((err) => {
    logger.fatal({ err }, 'Failed to start');
    process.exit(1);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
      logger.info(`${sig} received, shutting down`);
      await stop().catch(() => {});
      process.exit(0);
    });
  }
}
