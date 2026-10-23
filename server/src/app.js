import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { api } from './routes/index.js';
import { apiLimiter } from './middleware/rateLimits.js';
import { errorHandler, notFound, HttpError } from './middleware/errors.js';

const CLIENT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

/** Build the Express application (no listening, so tests can use Supertest directly). */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", ...env.clientOrigins, 'ws:', 'wss:'],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  // CORS allow-list; credentials are needed for the session cookie.
  app.use(
    cors({
      origin: (origin, cb) =>
        !origin || env.clientOrigins.includes(origin)
          ? cb(null, true)
          : cb(new HttpError(403, 'Origin not allowed', 'CORS')),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  // State-changing requests must be JSON: a cross-site HTML form cannot send application/json without CORS preflight.
  app.use('/api', (req, _res, next) => {
    if (
      ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) &&
      req.headers['content-length'] !== '0' &&
      req.is('application/json') === false
    ) {
      return next(
        new HttpError(415, 'Content-Type must be application/json', 'UNSUPPORTED_MEDIA_TYPE'),
      );
    }
    next();
  });
  app.use('/api', apiLimiter, api);
  app.use('/api', notFound);

  if (env.SERVE_CLIENT && fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) =>
      res.sendFile(path.join(CLIENT_DIST, 'index.html')),
    );
  }
  app.use(errorHandler);
  return app;
}
