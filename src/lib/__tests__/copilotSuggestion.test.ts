import { buildSuggestionPrompt, parseSuggestionContent } from '@/lib/copilotSuggestion';

describe('copilotSuggestion', () => {
  it('includes coding-only structured fields in prompt', () => {
    const codingPrompt = buildSuggestionPrompt({
      mode: 'coding',
      transcriptText: 'interviewer: Solve two-sum',
      latestQuestion: 'How would you optimize it?',
    });

    const userMessage = codingPrompt.find((msg) => msg.role === 'user');
    expect(userMessage?.content).toContain('"complexity"');
    expect(userMessage?.content).toContain('"edge_cases"');
    expect(userMessage?.content).toContain('"checklist"');

    const behavioralPrompt = buildSuggestionPrompt({
      mode: 'behavioral',
      transcriptText: 'interviewer: Tell me about yourself',
      latestQuestion: 'Walk me through a challenge',
    });

    const behavioralUserMessage = behavioralPrompt.find((msg) => msg.role === 'user');
    expect(behavioralUserMessage?.content).not.toContain('"complexity"');
  });

  it('parses and normalizes coding structured payload', () => {
    const parsed = parseSuggestionContent(
      JSON.stringify({
        short_answer: 'I would start with a hash map.',
        talking_points: ['Single pass', 'Store complements'],
        follow_up: 'Should I discuss memory tradeoffs?',
        complexity: 'Time O(n), Space O(n)',
        edge_cases: ['duplicates', 'negative numbers'],
        checklist: ['clarify input', 'write tests'],
      }),
      'coding',
    );

    expect(parsed.shortAnswer).toBe('I would start with a hash map.');
    expect(parsed.talkingPoints).toEqual(['Single pass', 'Store complements']);
    expect(parsed.followUp).toBe('Should I discuss memory tradeoffs?');
    expect(parsed.complexity).toBe('Time O(n), Space O(n)');
    expect(parsed.edgeCases).toEqual(['duplicates', 'negative numbers']);
    expect(parsed.checklist).toEqual(['clarify input', 'write tests']);
    expect(parsed.structured).toMatchObject({
      short_answer: 'I would start with a hash map.',
      talking_points: ['Single pass', 'Store complements'],
      complexity: 'Time O(n), Space O(n)',
      edge_cases: ['duplicates', 'negative numbers'],
      checklist: ['clarify input', 'write tests'],
    });
  });

  it('falls back gracefully for non-json content', () => {
    const parsed = parseSuggestionContent('Try clarifying constraints first.', 'general');

    expect(parsed.shortAnswer).toBe('Try clarifying constraints first.');
    expect(parsed.talkingPoints).toEqual([]);
    expect(parsed.structured).toEqual({
      short_answer: 'Try clarifying constraints first.',
      talking_points: [],
    });
  });
});
