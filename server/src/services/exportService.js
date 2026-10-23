/**
 * Comparison/Export Service (Chapter 3 §3.6.2, FR10): CSV for spreadsheets, JSON for full fidelity.
 */
export const CSV_COLUMNS = [
  ['jobId', (j) => j._id],
  ['jobLabel', (j) => j.settings?.label],
  ['jobCreatedAt', (j) => j.createdAt?.toISOString?.() ?? j.createdAt],
  ['jobStatus', (j) => j.status],
  ['protocol', (_j, r) => r.protocolName],
  ['iterations', (j) => j.settings?.iterations],
  ['warmupIterations', (j) => j.settings?.warmupIterations],
  ...['mean', 'median', 'p95', 'p99', 'min', 'max', 'stdDev'].map((k) => [`latency_${k}_ms`, (_j, r) => r.metrics?.latency?.[k]]),
  ...['mean', 'median', 'p95', 'p99', 'min', 'max', 'stdDev'].map((k) => [`processing_${k}_ms`, (_j, r) => r.metrics?.processingTime?.[k]]),
  ['throughput_ops_per_sec', (_j, r) => r.metrics?.throughput?.opsPerSec],
  ['successful_ops', (_j, r) => r.metrics?.throughput?.successfulOps],
  ['error_count', (_j, r) => r.metrics?.errorCount],
  ['error_rate', (_j, r) => r.metrics?.errorRate],
  ['cpu_total_ms', (_j, r) => r.metrics?.resources?.cpuTotalMs],
  ['cpu_per_op_us', (_j, r) => r.metrics?.resources?.cpuPerOpUs],
  ['heap_delta_kb', (_j, r) => r.metrics?.resources?.heapDeltaKB],
  ['enrolment_ms', (_j, r) => r.metrics?.enrolmentTimeMs],
  ['email_send_mean_ms', (_j, r) => r.metrics?.channel?.sendTime?.mean],
  ['email_provider', (_j, r) => r.metrics?.channel?.provider],
  ['webauthn_server_verify_mean_ms', (_j, r) => r.metrics?.serverVerifyTime?.mean],
  ['webauthn_ceremony_mean_ms', (_j, r) => r.metrics?.channel?.ceremonyTime?.mean],
  ['phishing', (_j, r) => r.securityOutcome?.phishingTest?.status],
  ['replay', (_j, r) => r.securityOutcome?.replayTest?.status],
  ['brute_force', (_j, r) => r.securityOutcome?.bruteForceTest?.status],
  ['expired_code', (_j, r) => r.securityOutcome?.expiredCodeTest?.status],
  ['desynchronisation', (_j, r) => r.securityOutcome?.desynchronisationObservation?.status],
  ['integration_effort_score', (_j, r) => r.integrationAssessment?.effortScore],
  ['usability_score', (_j, r) => r.usabilityAssessment?.score],
  ['hardware_requirement', (_j, r) => r.hardwareRequirement],
  ['channel_dependency', (_j, r) => r.channelDependency],
  ['node', (j) => j.environment?.node],
  ['cpu_model', (j) => j.environment?.cpuModel],
  ['os', (j) => (j.environment ? `${j.environment.platform} ${j.environment.osRelease}` : '')],
];

/** RFC 4180 quoting; also neutralises spreadsheet formula injection (=, +, -, @ prefixes). */
export function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** @param {{ job: any, results: any[] }[]} rows */
export function toCsv(rows) {
  const lines = [CSV_COLUMNS.map(([h]) => h).join(',')];
  for (const { job, results } of rows) for (const r of results) lines.push(CSV_COLUMNS.map(([, f]) => csvCell(f(job, r))).join(','));
  return lines.join('\r\n') + '\r\n';
}

export function toJson(rows, includeRaw = true) {
  return {
    exportedAt: new Date().toISOString(),
    note: 'WebAuthn timings come from a software Virtual Authenticator; email send times depend on provider and network; literature AAL classifications are not measured.',
    jobs: rows.map(({ job, results }) => ({
      job,
      results: results.map((r) => {
        if (includeRaw) return r;
        const { rawSamples: _omit, ...metrics } = r.metrics ?? {};
        return { ...r, metrics };
      }),
    })),
  };
}
