import { SMTPServer } from 'smtp-server';
import { logger } from '../../config/logger.js';

/**
 * Loopback SMTP sink (MAIL_PROVIDER=local, docs/DECISIONS.md D03).
 * Accepts STARTTLS with smtp-server's bundled development certificate, keeps the last
 * messages in memory (bounded) so the simulator can show the "inbox", and never relays.
 */
const MAX_MESSAGES = 50;
const messages = [];
let server = null;
let listeningPort = null;
let received = 0;

export function startLocalSink(port = Number(process.env.LOCAL_SMTP_PORT ?? 2526)) {
  if (server) return Promise.resolve(listeningPort);
  server = new SMTPServer({
    secure: false,
    authOptional: true,
    disabledCommands: ['AUTH'],
    banner: 'MFA platform local SMTP sink',
    size: 64 * 1024,
    logger: false,
    onData(stream, session, callback) {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        received++;
        const raw = Buffer.concat(chunks).toString('utf8');
        messages.push({
          id: received,
          receivedAt: new Date().toISOString(),
          to: session.envelope.rcptTo.map((r) => r.address),
          secure: Boolean(session.secure),
          raw,
        });
        if (messages.length > MAX_MESSAGES) messages.shift();
        callback();
      });
    },
  });
  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      server = null;
      // Another thread of this process (the API main thread) already owns the sink.
      if (err.code === 'EADDRINUSE') resolve(port);
      else reject(err);
    });
    server.listen(port, '127.0.0.1', () => {
      listeningPort = server.server.address().port;
      logger.info({ port: listeningPort }, 'Local SMTP sink listening');
      resolve(listeningPort);
    });
  });
}

export function stopLocalSink() {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => {
      server = null;
      listeningPort = null;
      resolve();
    });
  });
}

export const localSinkPort = () => listeningPort;
export const localSinkCount = () => received;

/** Most recent messages for one recipient (development simulator inbox). */
export function localInbox(address, limit = 10) {
  return messages
    .filter((m) => m.to.includes(address))
    .slice(-limit)
    .reverse();
}
