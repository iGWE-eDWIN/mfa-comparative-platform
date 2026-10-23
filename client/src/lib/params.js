/** Labels, help and input constraints for protocol parameters (FR3). Values come from protocols.defaultConfig. */
export const PARAM_META = {
  digits: { label: 'Digits', options: [6, 7, 8] },
  codeDigits: { label: 'Code digits', options: [6, 7, 8] },
  algorithm: { label: 'HMAC algorithm', options: ['SHA1', 'SHA256', 'SHA512'] },
  lookAheadWindow: {
    label: 'Look-ahead window',
    min: 0,
    max: 100,
    hint: 'Counter values accepted ahead of the server',
  },
  counterDrift: {
    label: 'Token drift per login',
    min: 0,
    max: 1000,
    hint: 'Extra presses per login (desync study)',
  },
  maxAttempts: { label: 'Max failed attempts', min: 1, max: 100 },
  timeStep: { label: 'Time step (s)', min: 5, max: 300 },
  window: { label: 'Validation window (± steps)', min: 0, max: 10 },
  clockSkewSeconds: {
    label: 'Token clock skew (s)',
    min: -3600,
    max: 3600,
    hint: 'Clock-drift study',
  },
  preventReuse: { label: 'Reject reused time step', hint: 'RFC 6238 §5.2' },
  advanceClockPerIteration: {
    label: 'Simulated clock (1 step per login)',
    hint: 'Each iteration is a fresh login',
  },
  expirySeconds: { label: 'Code expiry (s)', min: 30, max: 900 },
  resendCooldownSeconds: { label: 'Resend cooldown (s)', min: 0, max: 600 },
  sendEmail: { label: 'Send real email', hint: 'Off = server compute only' },
  recipient: { label: 'Benchmark recipient' },
  userVerification: {
    label: 'User verification',
    options: ['preferred', 'required', 'discouraged'],
  },
  attestation: { label: 'Attestation', options: ['none', 'direct'] },
  algorithm_webauthn: {
    label: 'COSE algorithm',
    options: [-7, -257, -8],
    names: { '-7': 'ES256 (-7)', '-257': 'RS256 (-257)', '-8': 'EdDSA (-8)' },
  },
  residentKey: { label: 'Resident key', options: ['preferred', 'required', 'discouraged'] },
  ceremonyTimeoutMs: { label: 'Ceremony timeout (ms)', min: 1000, max: 300000 },
  challengeTtlSeconds: { label: 'Challenge TTL (s)', min: 10, max: 600 },
};

export const metaFor = (protocol, name) =>
  (protocol === 'WebAuthn' && name === 'algorithm'
    ? PARAM_META.algorithm_webauthn
    : PARAM_META[name]) ?? { label: name };
