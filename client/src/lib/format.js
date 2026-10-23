export const PROTOCOLS = ['HOTP', 'TOTP', 'OOB Email', 'WebAuthn'];

/** Fixed categorical slot per protocol: colour follows the entity, never its rank. */
export const PROTOCOL_SLOT = { HOTP: 1, TOTP: 2, 'OOB Email': 3, WebAuthn: 4 };
export const seriesVar = (name) => `var(--series-${PROTOCOL_SLOT[name] ?? 1})`;

export function ms(v, digits) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const d = digits ?? (v < 0.01 ? 5 : v < 1 ? 4 : v < 100 ? 3 : 1);
  return `${Number(v).toFixed(d)} ms`;
}
export const num = (v, d = 0) =>
  v === null || v === undefined
    ? '—'
    : Number(v).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d });
export const pct = (v, d = 2) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(d)}%`);
export const when = (d) =>
  d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
export const durationBetween = (a, b) => {
  if (!a || !b) return '—';
  const s = (new Date(b) - new Date(a)) / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
};
