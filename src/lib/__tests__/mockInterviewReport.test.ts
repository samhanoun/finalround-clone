import { fallbackMockInterviewReport, normalizeMockInterviewReport } from '@/lib/mockInterviewReport';

describe('mockInterviewReport normalization', () => {
  it('ensures acceptance minimums for strengths, weaknesses, and prioritized next steps', () => {
    const normalized = normalizeMockInterviewReport(
      {
        overall_score: 81,
        strengths: ['Clear communication'],
        weaknesses: ['Needs deeper trade-off analysis'],
        next_steps: ['Practice systems design trade-off explanations'],
      },
      'general',
    );

    expect(normalized.strengths.length).toBeGreaterThanOrEqual(3);
    expect(normalized.weaknesses.length).toBeGreaterThanOrEqual(3);
    expect(normalized.next_steps.length).toBeGreaterThanOrEqual(3);
    expect(normalized.next_steps[0]).toMatch(/^P1:/);
    expect(normalized.next_steps[1]).toMatch(/^P2:/);
    expect(normalized.next_steps[2]).toMatch(/^P3:/);
  });

  it('falls back to rubric recommendations when partial rubric is provided', () => {
    const normalized = normalizeMockInterviewReport(
      {
        rubric: {
          clarity: { score: 5, evidence: 'Concise answers with clear sequencing' },
        },
      },
      'general',
    );

    const fallback = fallbackMockInterviewReport('general');

    expect(normalized.rubric.clarity.score).toBe(5);
    expect(normalized.rubric.clarity.recommendation).toBe(fallback.rubric.clarity.recommendation);
    expect(normalized.rubric.confidence.recommendation).toBe(fallback.rubric.confidence.recommendation);
  });
});
