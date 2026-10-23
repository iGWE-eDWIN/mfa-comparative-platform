import { describe, expect, it } from 'vitest';
import { csvCell, toCsv, toJson, CSV_COLUMNS } from '../../src/services/exportService.js';
import {
  applyAssessmentEdit,
  initialAssessments,
  measureIntegration,
  RUBRIC,
} from '../../src/services/assessmentService.js';
import { collectEnvironment } from '../../src/services/environmentService.js';
import { LITERATURE_TABLE_2_1 } from '../../src/services/literature.js';

const job = {
  _id: 'j1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  status: 'Completed',
  settings: { iterations: 10, warmupIterations: 2, label: '=HYPERLINK("x")' },
  environment: { node: 'v24', cpuModel: 'CPU, "quoted"', platform: 'linux', osRelease: '7' },
};
const result = {
  protocolName: 'HOTP',
  metrics: {
    latency: { mean: 1.5 },
    processingTime: { mean: 1 },
    throughput: { opsPerSec: 100 },
    errorRate: 0,
    rawSamples: { latency: [1, 2] },
  },
  securityOutcome: { replayTest: { status: 'pass' } },
};

describe('Export service', () => {
  it('escapes CSV per RFC 4180 and neutralises formula injection', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
  });
  it('writes one header row and one row per result', () => {
    const csv = toCsv([{ job, results: [result, { ...result, protocolName: 'TOTP' }] }]);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0].split(',')).toHaveLength(CSV_COLUMNS.length);
    expect(lines[1]).toContain("'=HYPERLINK");
    expect(lines[1]).toContain('"CPU, ""quoted"""');
  });
  it('JSON export can omit raw samples and carries the honesty note', () => {
    const full = toJson([{ job, results: [result] }], true);
    expect(full.jobs[0].results[0].metrics.rawSamples).toBeDefined();
    const slim = toJson([{ job, results: [result] }], false);
    expect(slim.jobs[0].results[0].metrics.rawSamples).toBeUndefined();
    expect(slim.note).toMatch(/Virtual Authenticator/);
  });
});

describe('Assessment rubric (FR12)', () => {
  it('measures lines of code and dependencies from the implementation', () => {
    const m = measureIntegration('WebAuthn');
    expect(m.linesOfCode).toBeGreaterThan(100);
    expect(m.thirdPartyDependencyCount).toBe(2);
    expect(measureIntegration('HOTP').thirdPartyDependencyCount).toBe(0);
  });
  it('builds 1–5 scores for every criterion of every protocol', () => {
    for (const p of ['HOTP', 'TOTP', 'OOB Email', 'WebAuthn']) {
      const a = initialAssessments(p);
      expect(a.integrationAssessment.criteria).toHaveLength(Object.keys(RUBRIC.integration).length);
      expect(a.usabilityAssessment.criteria).toHaveLength(Object.keys(RUBRIC.usability).length);
      for (const c of [...a.integrationAssessment.criteria, ...a.usabilityAssessment.criteria]) {
        expect(c.score).toBeGreaterThanOrEqual(1);
        expect(c.score).toBeLessThanOrEqual(5);
        expect(c.basis).toBeTruthy();
      }
    }
  });
  it('applies edits and recomputes the aggregate', () => {
    const a = initialAssessments('TOTP').usabilityAssessment;
    const e = applyAssessmentEdit(
      a,
      {
        scores: { userSteps: 1, accessibility: 1, errorRecovery: 1, enrolment: 1 },
        observations: 'tested by hand',
      },
      'u1',
    );
    expect(e.score).toBe(1);
    expect(e.observations).toBe('tested by hand');
    expect(e.editedBy).toBe('u1');
    expect(e.criteria.every((c) => c.editedByUser)).toBe(true);
  });
});

describe('Environment metadata and literature table', () => {
  it('captures runtime, hardware and library versions', () => {
    const e = collectEnvironment({ extra: 1 });
    expect(e.node).toBe(process.version);
    expect(e.cpuCount).toBeGreaterThan(0);
    expect(e.libraries['@simplewebauthn/server']).toMatch(/^\d+\./);
    expect(e.extra).toBe(1);
  });
  it('labels Table 2.1 as literature, not measured', () => {
    expect(LITERATURE_TABLE_2_1.label).toMatch(/not measured/);
    expect(LITERATURE_TABLE_2_1.rows.find((r) => r.criterion === 'NIST AAL Level').values).toEqual([
      'AAL1',
      'AAL2',
      'AAL1',
      'AAL2 / AAL3',
    ]);
  });
});
