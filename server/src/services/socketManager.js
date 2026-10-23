import { Server } from 'socket.io';
import * as cookie from 'cookie';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { verifySessionToken, SESSION_COOKIE } from './authService.js';

/**
 * Socket.IO Manager (Chapter 3 §3.6.2). Connections are authenticated with the same httpOnly
 * session cookie as the REST API; each socket joins only its own user room, so job events are
 * delivered only to the job's owner.
 */
let io = null;

export const JOB_EVENTS = [
  'job:started',
  'protocol:started',
  'iteration:progress',
  'protocol:completed',
  'job:completed',
  'job:failed',
  'job:cancelled',
];

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.clientOrigins, credentials: true },
    serveClient: false,
  });
  io.use(async (socket, next) => {
    try {
      const cookies = cookie.parse(socket.handshake.headers.cookie ?? '');
      const user = await verifySessionToken(cookies[SESSION_COOKIE]);
      if (!user) return next(new Error('unauthorised'));
      socket.data.user = user;
      next();
    } catch {
      next(new Error('unauthorised'));
    }
  });
  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.user.id}`);
    logger.debug({ user: socket.data.user.id }, 'socket connected');
  });
  return io;
}

export function emitToUser(userId, event, payload) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function closeSocket() {
  return new Promise((resolve) => (io ? io.close(() => resolve()) : resolve()));
}
