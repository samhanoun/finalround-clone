jest.mock('@/lib/llmRouter', () => ({ streamChat: jest.fn() }));

import {
  TASK_FEEDBACK,
  TASK_QUESTIONS,
  extractJsonObject,
  feedbackRequest,
  parseFeedback,
  parseFollowUp,
  parseQuestions,
  practiceTypeForRound,
  questionsRequest,
} from '@/lib/practice/practice';

const setup = { role: 'Staff Engineer', company: 'Acme', type: 'behavioral' as const, difficulty: 'medium' as const, count: 3 as const };

describe('extractJsonObject', () => {
  it('reads JSON wrapped in prose or a code fence', () => {
    expect(extractJsonObject('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('{broken')).toBeNull();
  });
});

describe('parseQuestions', () => {
  it('keeps valid, distinct questions up to the requested count', () => {
    const reply = JSON.stringify({
      questions: [
        { text: '1. Tell me about a launch you led.', type: 'behavioral', difficulty: 'hard' },
        { text: 'Tell me about a launch you led.', type: 'behavioral' },
        { text: 'Hi?' },
        'Describe a conflict with a peer and how it ended.',
        { text: 'How do you decide what not to build?', type: 'nonsense', difficulty: 'extreme' },
        { text: 'One question too many for this interview.' },
      ],
    });
    expect(parseQuestions(reply, setup)).toEqual([
      { text: 'Tell me about a launch you led.', type: 'behavioral', difficulty: 'hard' },
      { text: 'Describe a conflict with a peer and how it ended.', type: 'behavioral', difficulty: 'medium' },
      { text: 'How do you decide what not to build?', type: 'behavioral', difficulty: 'medium' },
    ]);
  });

  it('returns nothing for a reply that is not the expected JSON', () => {
    expect(parseQuestions('I cannot help with that.', setup)).toEqual([]);
  });

  it('labels untyped questions "general" in a mixed interview', () => {
    expect(parseQuestions('{"questions":[{"text":"Walk me through your résumé."}]}', { ...setup, type: 'mixed' })[0].type).toBe(
      'general',
    );
  });
});

describe('parseFeedback', () => {
  it('clamps the score to 1–10 and trims the lists', () => {
    const feedback = parseFeedback(
      JSON.stringify({
        score: 12.4,
        verdict: ' Solid. ',
        strengths: ['a', 'b', 'c', 'd', 'e'],
        improvements: ['x', 3],
        stronger_answer: ['p'],
      }),
    );
    expect(feedback).toEqual({ score: 10, verdict: 'Solid.', strengths: ['a', 'b', 'c', 'd'], improvements: ['x'], stronger_answer: ['p'] });
  });

  it('rejects a reply without a score', () => {
    expect(parseFeedback('{"verdict":"fine"}')).toBeNull();
    expect(parseFeedback('nothing')).toBeNull();
  });
});

describe('prompts', () => {
  const pack = { version: 1 as const, built_at: '', role: 'Staff Engineer', resume: 'Led the payments migration at Stripe.' };

  it('names the task and carries the role, type, difficulty and résumé', () => {
    const request = questionsRequest({ ...setup }, pack);
    expect(request.system[0]).toContain(TASK_QUESTIONS);
    expect(request.system[1]).toContain('Led the payments migration at Stripe.');
    expect(request.messages[0].content).toEqual(expect.stringContaining('Staff Engineer at Acme'));
    expect(request.messages[0].content).toEqual(expect.stringContaining('Number of questions: 3'));
  });

  it('sends the question and the answer for feedback', () => {
    const request = feedbackRequest({ text: 'Why us?', type: 'general', difficulty: 'easy' }, 'Because of the mission.', setup, null);
    expect(request.system[0]).toContain(TASK_FEEDBACK);
    expect(request.system[0]).not.toContain('follow_up');
    expect(request.messages[0].content).toEqual(expect.stringContaining('Why us?'));
    expect(request.messages[0].content).toEqual(expect.stringContaining('Because of the mission.'));
  });

  it('asks for a follow-up only when one may come', () => {
    const request = feedbackRequest({ text: 'Why us?', type: 'general', difficulty: 'easy' }, 'Because.', setup, null, { followUp: true });
    expect(request.system[0]).toContain('"follow_up"');
  });

  it('tells the model which bank questions are already in the interview', () => {
    const request = questionsRequest({ ...setup, count: 2 }, null, ['Why Acme?']);
    expect(request.messages[0].content).toEqual(expect.stringContaining('Number of questions: 2'));
    expect(request.messages[0].content).toEqual(expect.stringContaining('do not repeat'));
    expect(request.messages[0].content).toEqual(expect.stringContaining('- Why Acme?'));
  });
});

describe('parseFollowUp', () => {
  it('reads the follow-up question, or nothing when there is none', () => {
    expect(parseFollowUp('{"score":7,"follow_up":"What did the rollback cost you?"}')).toBe('What did the rollback cost you?');
    expect(parseFollowUp('{"score":7,"follow_up":""}')).toBeNull();
    expect(parseFollowUp('{"score":7}')).toBeNull();
    expect(parseFollowUp('no json')).toBeNull();
  });
});

describe('practiceTypeForRound', () => {
  it('picks the interview type that fits a goal’s round', () => {
    expect(practiceTypeForRound('technical')).toBe('technical');
    expect(practiceTypeForRound('system_design')).toBe('technical');
    expect(practiceTypeForRound('screen')).toBe('mixed');
    expect(practiceTypeForRound('final')).toBe('mixed');
    expect(practiceTypeForRound('behavioral')).toBe('behavioral');
    expect(practiceTypeForRound('other')).toBe('behavioral');
    expect(practiceTypeForRound(null)).toBe('behavioral');
  });
});
