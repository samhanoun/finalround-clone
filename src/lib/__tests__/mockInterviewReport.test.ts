import {
  LIVE_RUBRIC_KEYS,
  normalizeMockInterviewReport,
  normalizePracticeReport,
  PRACTICE_RUBRIC_KEYS,
} from '@/lib/mockInterviewReport';

describe('the live session report (normalizeMockInterviewReport)', () => {
  it('keeps exactly the six live areas, as the prompt and Past sessions name them', () => {
    const report = normalizeMockInterviewReport(
      {
        overall_score: 78,
        rubric: {
          communication: { score: 4, evidence: 'Clear openings', recommendation: 'Shorter wrap-ups' },
          role_fit: { score: 5, evidence: 'Payments depth', recommendation: '' },
          // The practice rubric's names are not live areas.
          clarity: { score: 2, evidence: 'x', recommendation: 'y' },
        },
      },
      'general',
    );

    expect(Object.keys(report!.rubric)).toEqual([...LIVE_RUBRIC_KEYS]);
    expect(report!.rubric.communication).toEqual({ score: 4, evidence: 'Clear openings', recommendation: 'Shorter wrap-ups' });
    expect(report!.rubric.role_fit.score).toBe(5);
    expect(report!.rubric).not.toHaveProperty('clarity');
  });

  it('leaves an area the model did not score as not captured, with no stock advice', () => {
    const report = normalizeMockInterviewReport({ overall_score: 70, rubric: { structure: { score: 3 } } }, 'general');

    expect(report!.rubric.structure).toEqual({ score: 3, evidence: '', recommendation: '' });
    for (const key of LIVE_RUBRIC_KEYS.filter((key) => key !== 'structure')) {
      expect(report!.rubric[key]).toEqual({ score: null, evidence: '', recommendation: '' });
    }
  });

  it('keeps a null score the model gave on purpose, with its reason', () => {
    const report = normalizeMockInterviewReport(
      { overall_score: 60, rubric: { technical_accuracy: { score: null, evidence: 'No technical questions came up' } } },
      'behavioral',
    );
    expect(report!.rubric.technical_accuracy).toEqual({ score: null, evidence: 'No technical questions came up', recommendation: '' });
  });

  it('does not pad strengths, weaknesses or next steps with stock lines', () => {
    const report = normalizeMockInterviewReport(
      { overall_score: 81, strengths: ['Clear communication'], weaknesses: [], next_steps: ['Practise trade-offs'] },
      'general',
    );

    expect(report!.strengths).toEqual(['Clear communication']);
    expect(report!.weaknesses).toEqual([]);
    expect(report!.next_steps).toEqual(['P1: Practise trade-offs']);
  });

  it('is no report without an overall score, rather than a stand-in', () => {
    for (const input of [{}, null, undefined, 'not an object', 42, [], { overall_score: NaN }, { overall_score: 'high' }, { strengths: ['Only one'] }]) {
      expect(normalizeMockInterviewReport(input, 'general')).toBeNull();
    }
  });

  it('reads numbers written as text and clamps scores to their scales', () => {
    const report = normalizeMockInterviewReport(
      { overall_score: '150', rubric: { ownership: { score: '4' }, structure: { score: 0 }, communication: { score: 10 } } },
      'general',
    );
    expect(report!.overall_score).toBe(100);
    expect(report!.rubric.ownership.score).toBe(4);
    expect(report!.rubric.structure.score).toBe(1);
    expect(report!.rubric.communication.score).toBe(5);
    expect(normalizeMockInterviewReport({ overall_score: -5 }, 'general')!.overall_score).toBe(0);
  });

  it('has no hiring signal unless the model gave a known one', () => {
    expect(normalizeMockInterviewReport({ overall_score: 50, hiring_signal: 'maybe' }, 'general')!.hiring_signal).toBeNull();
    expect(normalizeMockInterviewReport({ overall_score: 50, hiring_signal: 'lean_hire' }, 'general')!.hiring_signal).toBe('lean_hire');
  });
});

describe('the practice report (normalizePracticeReport)', () => {
  it('keeps the four practice areas the model scored, and leaves the rest out', () => {
    const report = normalizePracticeReport(
      {
        overall_score: 72,
        hiring_signal: 'lean_hire',
        rubric: {
          clarity: { score: 4, evidence: 'Short sentences', recommendation: 'Keep the opening to one line.' },
          structure: { score: 3, evidence: 'Result came early', recommendation: 'Situation, action, result.' },
          confidence: { evidence: 'Not scored' },
          // A live area is not a practice one.
          communication: { score: 5 },
        },
      },
      'general',
    );

    expect(Object.keys(report!.rubric).sort()).toEqual(['clarity', 'structure']);
    expect(report!.rubric.clarity).toEqual({ score: 4, evidence: 'Short sentences', recommendation: 'Keep the opening to one line.' });
    for (const key of Object.keys(report!.rubric)) expect(PRACTICE_RUBRIC_KEYS).toContain(key);
  });

  it('keeps only what the model wrote in its lists', () => {
    const report = normalizePracticeReport({ overall_score: 70, strengths: ['Uses numbers'], next_steps: ['P3: Rewrite two stories'] }, 'general');
    expect(report!.strengths).toEqual(['Uses numbers']);
    expect(report!.weaknesses).toEqual([]);
    expect(report!.next_steps).toEqual(['P1: Rewrite two stories']);
  });

  it('is no report without an overall score', () => {
    expect(normalizePracticeReport({ summary: 'Good' }, 'general')).toBeNull();
    expect(normalizePracticeReport(null, 'general')).toBeNull();
  });
});
