import { env } from '../config/env.js';
import { parseKey } from '../lib/crypto.js';

/** Server-held keys. Never sent to the browser and never logged. */
export const keys = Object.freeze({
  encryptionKey: parseKey(env.SECRETS_ENCRYPTION_KEY),
  otpPepper: Buffer.from(env.OTP_HMAC_KEY),
});
