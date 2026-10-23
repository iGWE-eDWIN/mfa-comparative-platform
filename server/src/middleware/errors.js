import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { logger } from '../config/logger.js';

export class HttpError extends Error {
  constructor(status, message, code = undefined, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function notFound(req, _res, next) {
  next(new HttpError(404, `No route for ${req.method} ${req.path}`, 'NOT_FOUND'));
}

/** Centralised error handler: one envelope { error: { message, code, details? } } for every failure. */
export function errorHandler(err, req, res, _next) {
  let status = err.status ?? 500;
  let body = { message: err.message, code: err.code ?? undefined, details: err.details };
  if (err instanceof ZodError) {
    status = 400;
    body = {
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    body = { message: 'Invalid identifier', code: 'INVALID_ID' };
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    body = { message: 'Malformed JSON body', code: 'BAD_JSON' };
  } else if (err.code === 11000) {
    status = 409;
    body = { message: 'Duplicate value', code: 'DUPLICATE' };
  }
  if (status >= 500) {
    logger.error({ err, path: req.path }, 'unhandled error');
    body = { message: 'Internal server error', code: err.code ?? 'INTERNAL' };
    if (err.status === 503) body.message = err.message;
  }
  res.status(status).json({ error: body });
}
