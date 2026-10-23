import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getModuleClass } from '../protocols/ProtocolManager.js';

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Integration-effort and usability rubric (FR12, Chapter 3 §3.8.2). Scores run from 1 (worst) to 5 (best).
 * Measurable criteria (dependencies, lines of integration code) are scored from measured
 * values with the thresholds below. The others are the author's documented initial assessment
 * and can be edited by the user; edits are stored with who made them and when.
 */
export const RUBRIC = {
  integration: {
    dependencies: { label: 'Third-party dependencies', measured: true, scale: '5: none beyond node:crypto · 4: 1 · 3: 2 · 2: 3 · 1: 4 or more' },
    setupSteps: { label: 'Developer setup steps', measured: false, scale: '5: 1–2 steps · 4: 3 · 3: 4–5 · 2: 6–7 · 1: 8 or more' },
    linesOfCode: { label: 'Lines of integration code', measured: true, scale: '5: <150 · 4: <300 · 3: <500 · 2: <800 · 1: 800 or more (non-blank, non-comment lines)' },
    serverState: { label: 'Server-side state to manage', measured: false, scale: '5: none · 4: one value · 3: secret + counter/step · 2: secret + challenges + limits · 1: multiple stores + external service' },
  },
  usability: {
    userSteps: { label: 'User steps per login', measured: false, scale: '5: 1 gesture · 4: 2 · 3: 3 · 2: 4 · 1: 5 or more' },
    errorRecovery: { label: 'Error recovery', measured: false, scale: '5: self-service, immediate · 3: retry with waiting/resend · 1: needs administrator or re-enrolment' },
    accessibility: { label: 'Accessibility', measured: false, scale: '5: no reading/typing of codes · 3: transcribe short code · 1: transcription under time pressure across devices' },
    enrolment: { label: 'Enrolment effort', measured: false, scale: '5: none · 4: one confirmation · 3: scan QR/enter secret · 1: hardware purchase/provisioning' },
  },
};

/** Author's initial (editable) judgements with the reason for each, so that they can be defended. */
const INITIAL = {
  HOTP: {
    integration: { setupSteps: [4, 'Generate secret, encrypt and store, show QR, verify first code, persist counter'], serverState: [3, 'Encrypted secret + counter, updated on every login'] },
    usability: { userSteps: [3, 'Open app or press token, read code, type code'], errorRecovery: [2, 'Counter drift beyond window needs resynchronisation by consecutive codes or an admin'], accessibility: [3, 'Transcribe 6 digits; no time pressure'], enrolment: [3, 'Scan QR or provision a hardware token'] },
  },
  TOTP: {
    integration: { setupSteps: [4, 'Generate secret, encrypt and store, show QR, verify first code, track last used step'], serverState: [3, 'Encrypted secret + last used step'] },
    usability: { userSteps: [3, 'Open app, read code, type code'], errorRecovery: [4, 'Wait for the next code; clock drift is tolerated by the window'], accessibility: [2, 'Transcribe 6 digits before the 30 s step ends'], enrolment: [3, 'Scan QR in an authenticator app'] },
  },
  'OOB Email': {
    integration: { setupSteps: [5, 'Configure SMTP provider credentials (and a test inbox for development)'], serverState: [2, 'Hashed challenge + expiry + attempts + cooldown, plus an external mail provider'] },
    usability: { userSteps: [4, 'Switch to the mail client, open the message, copy the code, return and enter it'], errorRecovery: [3, 'Resend after the cooldown; delivery delays can expire the code'], accessibility: [3, 'Copy-paste is possible but means switching context between apps'], enrolment: [5, 'Uses the address already registered'] },
  },
  WebAuthn: {
    integration: { setupSteps: [2, 'RP ID/origin configuration, registration and authentication ceremonies, challenge store, credential store, browser library, HTTPS in production'], serverState: [2, 'Public key + sign counter + transports + single-use challenges'] },
    usability: { userSteps: [5, 'One gesture (touch or biometric) through the browser prompt'], errorRecovery: [2, 'Lost authenticator needs another registered credential or account recovery'], accessibility: [4, 'No code transcription; depends on the platform authenticator UI'], enrolment: [4, 'One browser prompt; a hardware key would need purchase'] },
  },
};

const score = (thresholds, v) => {
  for (const [limit, s] of thresholds) if (v < limit) return s;
  return 1;
};

/** Count non-blank, non-comment lines in the protocol's implementation files. */
export function measureIntegration(protocol) {
  const M = getModuleClass(protocol);
  let lines = 0;
  const files = [];
  for (const rel of M.metadata.implementationFiles) {
    const file = path.join(SRC_DIR, rel);
    if (!fs.existsSync(file)) continue;
    const n = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*')).length;
    lines += n;
    files.push({ file: rel, lines: n });
  }
  const thirdParty = M.metadata.dependencies.filter((d) => !d.startsWith('node:') && !d.includes('benchmark only'));
  return { linesOfCode: lines, files, dependencies: M.metadata.dependencies, thirdPartyDependencyCount: thirdParty.length };
}

/** Build the initial integrationAssessment and usabilityAssessment objects for a result. */
export function initialAssessments(protocol) {
  const measured = measureIntegration(protocol);
  const init = INITIAL[protocol];
  const crit = (group, key, s, basis, measuredValue) => ({ criterion: key, label: RUBRIC[group][key].label, score: s, basis, measured: RUBRIC[group][key].measured, ...(measuredValue !== undefined && { measuredValue }) });
  const integration = [
    crit('integration', 'dependencies', [5, 4, 3, 2][measured.thirdPartyDependencyCount] ?? 1, `${measured.thirdPartyDependencyCount} third-party runtime package(s): ${measured.dependencies.join(', ')}`, measured.thirdPartyDependencyCount),
    crit('integration', 'linesOfCode', score([[150, 5], [300, 4], [500, 3], [800, 2]], measured.linesOfCode), `${measured.linesOfCode} lines across ${measured.files.length} file(s)`, measured.linesOfCode),
    ...Object.entries(init.integration).map(([k, [s, basis]]) => crit('integration', k, s, basis)),
  ];
  const usability = Object.entries(init.usability).map(([k, [s, basis]]) => crit('usability', k, s, basis));
  const mean = (arr) => Math.round((arr.reduce((a, c) => a + c.score, 0) / arr.length) * 100) / 100;
  return {
    integrationAssessment: { effortScore: mean(integration), criteria: integration, files: measured.files, observations: '', source: 'rubric v1 (measured + author initial assessment)', editedBy: null, editedAt: null },
    usabilityAssessment: { score: mean(usability), criteria: usability, observations: '', source: 'rubric v1 (author initial assessment)', editedBy: null, editedAt: null },
  };
}

/** Apply user edits (scores 1–5, observations) and recompute the aggregate. */
export function applyAssessmentEdit(current, edit, userId) {
  const next = structuredClone(current ?? {});
  next.criteria = (next.criteria ?? []).map((c) => (edit.scores?.[c.criterion] !== undefined ? { ...c, score: edit.scores[c.criterion], basis: edit.basis?.[c.criterion] ?? c.basis, editedByUser: true } : c));
  if (edit.observations !== undefined) next.observations = edit.observations;
  const total = next.criteria.reduce((a, c) => a + c.score, 0);
  const agg = next.criteria.length ? Math.round((total / next.criteria.length) * 100) / 100 : null;
  if ('effortScore' in next) next.effortScore = agg;
  else next.score = agg;
  next.editedBy = String(userId);
  next.editedAt = new Date().toISOString();
  return next;
}
