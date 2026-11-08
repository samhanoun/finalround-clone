import {
  HIRING_SIGNALS,
  LIVE_RUBRIC_KEYS,
  MockInterviewReportSchema,
  normalizeMockInterviewReport,
  PracticeReportSchema,
  normalizePracticeReport,
  reportToLegacyPayload,
  type MockInterviewReport,
} from '@/lib/mockInterviewReport';

// ---------------------------------------------------------------------------
// Contract: a normalized report holds only what the model wrote. It validates
// against its schema, every list item came from the input, and every rubric
// score is the model's (or null), never a stand-in.
// ---------------------------------------------------------------------------

const MODEL_REPLY = {
  overall_score: 74,
  hiring_signal: 'lean_hire',
  summary: 'Specific answers with numbers; ownership could come through more.',
  strengths: ['Uses numbers to show impact', 'Answers stay on the question'],
  weaknesses: ['Too much "we"'],
  next_steps: ['Rewrite two stories around your own decisions', 'P9 - Practise a 90-second version'],
  rubric: {
    communication: { score: 4, evidence: 'Clear openings', recommendation: 'Shorter wrap-ups' },
    technical_accuracy: { score: 3, evidence: 'Right idea, thin on trade-offs', recommendation: 'Name one trade-off per answer' },
    problem_solving: { score: 4, evidence: 'Broke the design into steps', recommendation: 'Say the constraints first' },
    structure: { score: 3, evidence: 'Result came early', recommendation: 'Situation, action, result' },
    ownership: { score: null, evidence: 'Too little in the log', recommendation: '' },
  },
};

function assertHonest(report: MockInterviewReport, input: typeof MODEL_REPLY) {
  expect(() => MockInterviewReportSchema.parse(report)).not.toThrow();
  expect(HIRING_SIGNALS).toContain(report.hiring_signal);
  expect(report.strengths.every((item) => input.strengths.includes(item))).toBe(true);
  expect(report.weaknesses.every((item) => input.weaknesses.includes(item))).toBe(true);
  expect(report.next_steps).toHaveLength(input.next_steps.length);
  const given = input.rubric as Record<string, { score: number | null } | undefined>;
  for (const key of LIVE_RUBRIC_KEYS) {
    expect(report.rubric[key].score).toBe(given[key]?.score ?? null);
  }
}

describe('mockInterviewReport contract', () => {
  describe('the live report keeps what the model wrote', () => {
    for (const mode of ['general', 'coding', 'behavioral', 'phone', 'video', '']) {
      it(`mode="${mode}"`, () => {
        const report = normalizeMockInterviewReport(MODEL_REPLY, mode);
        expect(report?.mode).toBe(mode);
        assertHonest(report!, MODEL_REPLY);
      });
    }

    it('role_fit, which the reply left out, is not captured', () => {
      expect(normalizeMockInterviewReport(MODEL_REPLY, 'general')!.rubric.role_fit).toEqual({ score: null, evidence: '', recommendation: '' });
    });
  });

  describe('a reply that is not a report is none', () => {
    for (const [name, input] of Object.entries({ empty: {}, null: null, undefined, string: 'not an object', number: 42, array: [] })) {
      it(name, () => {
        expect(normalizeMockInterviewReport(input, 'general')).toBeNull();
        expect(normalizePracticeReport(input, 'general')).toBeNull();
      });
    }
  });

  describe('lists', () => {
    it('next steps get priority labels in order, without double prefixes', () => {
      const report = normalizeMockInterviewReport(
        { overall_score: 60, next_steps: ['P5: Already labeled', 'P99 - Other label', 'Clean text', 'Do W'] },
        'general',
      );
      expect(report!.next_steps).toEqual(['P1: Already labeled', 'P2: Other label', 'P3: Clean text', 'P4: Do W']);
    });

    it('duplicates and blanks are dropped, and nothing is added', () => {
      const report = normalizeMockInterviewReport(
        { overall_score: 60, strengths: ['Good communication', 'Good communication', '  ', 'Unique'], weaknesses: ['Needs work', 'Needs work'] },
        'general',
      );
      expect(report!.strengths).toEqual(['Good communication', 'Unique']);
      expect(report!.weaknesses).toEqual(['Needs work']);
    });
  });

  describe('scores', () => {
    it('clamps the overall score to 0-100 and rubric scores to 1-5', () => {
      expect(normalizeMockInterviewReport({ overall_score: 150 }, 'general')!.overall_score).toBe(100);
      expect(normalizeMockInterviewReport({ overall_score: -5 }, 'general')!.overall_score).toBe(0);
      const report = normalizeMockInterviewReport({ overall_score: 50, rubric: { communication: { score: 10 }, structure: { score: 0 } } }, 'general');
      expect(report!.rubric.communication.score).toBe(5);
      expect(report!.rubric.structure.score).toBe(1);
    });
  });

  describe('the practice report has its own four-area schema', () => {
    it('validates, with only the areas the model scored', () => {
      const report = normalizePracticeReport(
        { overall_score: 72, rubric: { clarity: { score: 4, evidence: 'Short sentences' }, relevance: { score: null } } },
        'general',
      );
      expect(() => PracticeReportSchema.parse(report)).not.toThrow();
      expect(report!.rubric).toEqual({ clarity: { score: 4, evidence: 'Short sentences', recommendation: '' } });
    });
  });

  describe('reportToLegacyPayload', () => {
    it('wraps the report in the legacy envelope', () => {
      const report = normalizeMockInterviewReport(MODEL_REPLY, 'behavioral')!;
      const payload = reportToLegacyPayload(report);

      expect(payload.mode).toBe('behavioral');
      expect(payload.strengths).toBe(report.strengths);
      expect(payload.weaknesses).toBe(report.weaknesses);
      expect(payload.next_steps).toBe(report.next_steps);
      expect(payload.report).toBe(report);
    });
  });
});
