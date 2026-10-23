import { SESSION_COOKIE, verifySessionToken } from '../services/authService.js';
import { HttpError } from './errors.js';

/** Protect a route: requires a valid session cookie for an active user. */
export async function requireAuth(req, _res, next) {
  const user = await verifySessionToken(req.cookies?.[SESSION_COOKIE]);
  if (!user) return next(new HttpError(401, 'Authentication required', 'UNAUTHENTICATED'));
  req.user = user;
  next();
}

/** Role-based authorisation; use after requireAuth. */
export const requireRole =
  (...roles) =>
  (req, _res, next) =>
    roles.includes(req.user?.role)
      ? next()
      : next(new HttpError(403, 'Insufficient permissions', 'FORBIDDEN'));
