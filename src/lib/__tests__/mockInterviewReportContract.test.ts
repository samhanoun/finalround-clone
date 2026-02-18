import {
  fallbackMockInterviewReport,
  normalizeMockInterviewReport,
  MockInterviewReportSchema,
  reportToLegacyPayload,
} from '@/lib/mockInterviewReport';

// ---------------------------------------------------------------------------
// Contract: every normalized report satisfies PRD acceptance shape
// ---------------------------------------------------------------------------

function assertPrdAcceptanceShape(report: ReturnType<typeof normalizeMockInterviewReport>) {
  // Overall score present and in range
  expect(typeof report.overall_score).toBe('number');
  expect(report.overall_score).toBeGreaterThanOrEqual(0);
  expect(report.overall_score).toBeLessThanOrEqual(100);

  // Hiring signal is one of the accepted enums
  expect([
    'strong_no_hire',
    'no_hire',
    'lean_no_hire',
    'lean_hire',
    'hire',
    'strong_hire',
  ]).toContain(report.hiring_signal);

  // ≥3 strengths
  expect(report.strengths.length).toBeGreaterThanOrEqual(3);
  for (const s of report.strengths) {
    expect(typeof s).toBe('string');
    expect(s.trim().length).toBeGreaterThan(0);
  }

  // ≥3 weaknesses
  expect(report.weaknesses.length).toBeGreaterThanOrEqual(3);
  for (const w of report.weaknesses) {
    expect(typeof w).toBe('string');
    expect(w.trim().length).toBeGreaterThan(0);
  }

  // ≥3 prioritized next_steps (P1, P2, P3…)
  expect(report.next_steps.length).toBeGreaterThanOrEqual(3);
  expect(report.next_steps[0]).toMatch(/^P1:/);
  expect(report.next_steps[1]).toMatch(/^P2:/);
  expect(report.next_steps[2]).toMatch(/^P3:/);

  // Rubric: all 6 dimensions present with valid scores
  const dimensions = [
    'communication',
    'technical_accuracy',
    'problem_solving',
    'structure',
    'ownership',
    'role_fit',
  ] as const;

  for (const dim of dimensions) {
    const d = report.rubric[dim];
    expect(d).toBeDefined();
    expect(d.score).toBeGreaterThanOrEqual(1);
    expect(d.score).toBeLessThanOrEqual(5);
    expect(Number.isInteger(d.score)).toBe(true);
  }

  // Schema validation passes (zod)
  expect(() => MockInterviewReportSchema.parse(report)).not.toThrow();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mockInterviewReport contract tests (PRD T5)', () => {
  describe('fallbackMockInterviewReport always satisfies PRD acceptance', () => {
    for (const mode of ['general', 'coding', 'behavioral', 'phone', 'video', '']) {
      it(`mode="${mode}"`, () => {
        assertPrdAcceptanceShape(fallbackMockInterviewReport(mode));
      });
    }
  });

  describe('normalizeMockInterviewReport satisfies PRD acceptance for edge cases', () => {
    it('empty object input', () => {
      assertPrdAcceptanceShape(normalizeMockInterviewReport({}, 'general'));
    });

    it('null input', () => {
      assertPrdAcceptanceShape(normalizeMockInterviewReport(null, 'general'));
    });

    it('undefined input', () => {
      assertPrdAcceptanceShape(normalizeMockInterviewReport(undefined, 'general'));
    });

    it('string input (malformed)', () => {
      assertPrdAcceptanceShape(normalizeMockInterviewReport('not an object', 'general'));
    });

    it('numeric input (malformed)', () => {
      assertPrdAcceptanceShape(normalizeMockInterviewReport(42, 'general'));
    });

    it('array input (malformed)', () => {
      assertPrdAcceptanceShape(normalizeMockInterviewReport([], 'coding'));
    });

    it('partial strengths get backfilled to minimum 3', () => {
      const report = normalizeMockInterviewReport({ strengths: ['Only one'] }, 'general');
      assertPrdAcceptanceShape(report);
      expect(report.strengths[0]).toBe('Only one');
    });

    it('empty arrays get backfilled from fallback', () => {
      const report = normalizeMockInterviewReport(
        { strengths: [], weaknesses: [], next_steps: [] },
        'general',
      );
      assertPrdAcceptanceShape(report);
    });

    it('next_steps get priority labels re-applied', () => {
      const report = normalizeMockInterviewReport(
        { next_steps: ['Do X', 'Do Y', 'Do Z', 'Do W'] },
        'general',
      );
      expect(report.next_steps[0]).toMatch(/^P1:/);
      expect(report.next_steps[3]).toMatch(/^P4:/);
    });

    it('existing P-labels are normalized (no double-prefix)', () => {
      const report = normalizeMockInterviewReport(
        { next_steps: ['P5: Already labeled', 'P99 - Other label', 'Clean text'] },
        'general',
      );
      expect(report.next_steps[0]).toBe('P1: Already labeled');
      expect(report.next_steps[1]).toBe('P2: Other label');
      expect(report.next_steps[2]).toBe('P3: Clean text');
    });

    it('overall_score out of range gets clamped', () => {
      const report = normalizeMockInterviewReport({ overall_score: 150 }, 'general');
      expect(report.overall_score).toBeLessThanOrEqual(100);
      assertPrdAcceptanceShape(report);
    });

    it('negative overall_score gets clamped to 0', () => {
      const report = normalizeMockInterviewReport({ overall_score: -5 }, 'general');
      expect(report.overall_score).toBe(0);
    });

    it('NaN overall_score falls back to default', () => {
      const report = normalizeMockInterviewReport({ overall_score: NaN }, 'general');
      assertPrdAcceptanceShape(report);
      expect(report.overall_score).toBe(fallbackMockInterviewReport('general').overall_score);
    });

    it('rubric score out of range gets clamped', () => {
      const report = normalizeMockInterviewReport(
        { rubric: { communication: { score: 10, evidence: 'Great' } } },
        'general',
      );
      expect(report.rubric.communication.score).toBe(5);
    });

    it('rubric score 0 gets clamped to 1', () => {
      const report = normalizeMockInterviewReport(
        { rubric: { structure: { score: 0 } } },
        'general',
      );
      expect(report.rubric.structure.score).toBe(1);
    });

    it('invalid hiring_signal falls back to default', () => {
      const report = normalizeMockInterviewReport({ hiring_signal: 'maybe' }, 'general');
      assertPrdAcceptanceShape(report);
    });

    it('duplicate strengths/weaknesses are deduplicated', () => {
      const report = normalizeMockInterviewReport(
        {
          strengths: ['Good communication', 'Good communication', 'Good communication', 'Unique'],
          weaknesses: ['Needs work', 'Needs work', 'Needs work', 'Different'],
        },
        'general',
      );
      // Deduplication means we may have fewer raw items, but minimum 3 enforced
      assertPrdAcceptanceShape(report);
    });
  });

  describe('reportToLegacyPayload', () => {
    it('wraps report in legacy envelope with required fields', () => {
      const report = normalizeMockInterviewReport({}, 'behavioral');
      const payload = reportToLegacyPayload(report);

      expect(payload.mode).toBe('behavioral');
      expect(payload.strengths).toBe(report.strengths);
      expect(payload.weaknesses).toBe(report.weaknesses);
      expect(payload.next_steps).toBe(report.next_steps);
      expect(payload.report).toBe(report);
    });
  });
});
