import {
  FALLBACK_ANSWER_AT,
  QuestionGate,
  categorizeQuestion,
  isFiller,
  scoreUtterance,
  type GatedQuestion,
  type QuestionCategory,
} from '@/lib/copilot/questionGate';
import type { Utterance } from '@/lib/stt/utterances';

/**
 * Interviewer lines as Deepgram returns them with smart formatting: some
 * questions lose their "?", some carry fillers, some are prompts or long
 * problem statements rather than questions.
 */
const QUESTIONS: Array<[string, QuestionCategory]> = [
  ['Tell me about yourself.', 'behavioral'],
  ['So, um, why do you want to work here?', 'behavioral'],
  ['Walk me through your resume.', 'behavioral'],
  ['Tell me about a time you disagreed with your manager.', 'behavioral'],
  ['Can you describe a situation where you had to deal with a difficult stakeholder?', 'behavioral'],
  ["What's your biggest weakness?", 'behavioral'],
  ['What are you most proud of in your career so far?', 'behavioral'],
  ['How do you handle tight deadlines', 'behavioral'],
  ['Give me an example of a time you failed.', 'behavioral'],
  ['Why are you leaving your current job?', 'behavioral'],
  ['Where do you see yourself in five years?', 'behavioral'],
  ['How do you prioritize when everything is urgent?', 'behavioral'],
  ['Describe a time you received tough feedback and what you did with it.', 'behavioral'],
  ["I'd love to hear about a project you led end to end.", 'behavioral'],
  ['Okay, great. Why did you leave Stripe?', 'behavioral'],
  ['Tell me about a conflict on your team and how it was resolved.', 'behavioral'],
  ['What motivates you?', 'behavioral'],
  ['Why should we hire you?', 'behavioral'],
  ['How would you design a URL shortener?', 'system_design'],
  ['Design a rate limiter for our public API.', 'system_design'],
  ['How would you scale this to millions of users?', 'system_design'],
  ["Let's say we need to build a news feed like Twitter's. How would you approach it?", 'system_design'],
  ['What happens when the database becomes the bottleneck', 'system_design'],
  ['How would you architect a notification service that has to be highly available?', 'system_design'],
  ['Walk me through how you would shard the users table.', 'system_design'],
  ['Write a function that reverses a linked list.', 'coding'],
  ['Given an array of integers, return the indices of the two numbers that add up to a target.', 'coding'],
  ["What's the time complexity of your solution?", 'coding'],
  ['Can you implement an LRU cache?', 'coding'],
  ['So the problem is, given a string, find the longest substring without repeating characters.', 'coding'],
  ['How would you optimize that algorithm?', 'coding'],
  ['Could you write a SQL query that finds the second highest salary?', 'coding'],
  ['Can you think of any edge cases for this function?', 'other'],
  ["What's the difference between a process and a thread?", 'technical'],
  ['How does garbage collection work in Java?', 'technical'],
  ['Explain how React reconciliation works.', 'technical'],
  ['What is a database index and when would you not use one?', 'technical'],
  ['How do you test asynchronous code?', 'technical'],
  ['What happens when you type a URL into the browser and press enter?', 'other'],
  ['Have you worked with Kubernetes before?', 'technical'],
  ['Are you familiar with event sourcing?', 'other'],
  ['How did you measure the impact of that change?', 'other'],
  ['What would you do differently next time?', 'other'],
  ['Why?', 'other'],
  ['How so?', 'other'],
  ['Can you give me an example?', 'other'],
  ['And what was your specific role in that?', 'other'],
  ['Do you have any questions for me?', 'other'],
  ['What are your salary expectations?', 'other'],
  ['When could you start?', 'other'],
  ["I'm curious how you'd explain that to a non-technical person.", 'other'],
  ['Talk me through your thought process.', 'other'],
  ['Interesting. And how did the team react?', 'other'],
  ['What did you learn from that?', 'behavioral'],
  ['Is there anything you would change about how that project was run?', 'other'],
  ['Help me understand why you chose Postgres over Mongo.', 'technical'],
  ['Suppose the cache goes down. What happens to your service?', 'technical'],
  ['How comfortable are you with on-call?', 'other'],
  ['Which of these approaches would you pick and why?', 'other'],
  ['Can you explain what a closure is in JavaScript?', 'technical'],
];

const NOT_QUESTIONS: string[] = [
  'Great, thanks.',
  'Okay, that makes sense.',
  'Let me share my screen.',
  'Can you hear me okay?',
  "You're on mute.",
  'Sorry, my internet cut out for a second.',
  'Nice to meet you.',
  "I'm the hiring manager for the platform team.",
  'Let me tell you a bit about the role.',
  'We have about 15 minutes left.',
  'Interesting.',
  'Right, right.',
  'Take your time.',
  "That's a good answer.",
  "Okay, so let's move on to the next part.",
  "I'll send you the details by email.",
  "So we're a team of eight engineers.",
  'Can you see my screen?',
  'How are you doing today?',
  "Hi, how's it going?",
  'Give me one second.',
  'Sorry, go ahead.',
  'Yeah, I think that is right.',
  'Thanks for walking me through that.',
  'We use React and Node on the front end.',
  "That's all I had.",
  'Hmm.',
  'Okay.',
  'Does that make sense?',
  'Sorry, could you repeat that?',
  'Shall we get started?',
  'What we do here is mostly payments infrastructure.',
  'The next round will be with the CTO.',
  "I'm going to paste the problem into the chat.",
  'Got it, thank you.',
  'Mm-hmm.',
  'Cool, cool.',
  'Any questions so far?',
  "I think we're good on time.",
  'So, yeah, that is the team.',
];

function wouldAnswer(text: string): boolean {
  const verdict = scoreUtterance(text);
  return verdict.decision === 'answer' || (verdict.decision === 'unsure' && verdict.score >= FALLBACK_ANSWER_AT);
}

describe('question gate scoring on an interview corpus', () => {
  it('answers at least 90% of real questions', () => {
    const answered = QUESTIONS.filter(([text]) => wouldAnswer(text));
    expect(answered.length / QUESTIONS.length).toBeGreaterThanOrEqual(0.9);
  });

  it('answers at most 10% of non-questions', () => {
    const fired = NOT_QUESTIONS.filter(wouldAnswer);
    expect(fired.length / NOT_QUESTIONS.length).toBeLessThanOrEqual(0.1);
  });

  it('puts most questions in the right category', () => {
    const wrong = QUESTIONS.filter(([text, category]) => categorizeQuestion(text) !== category);
    expect(wrong.length / QUESTIONS.length).toBeLessThanOrEqual(0.15);
  });

  it('treats acknowledgements and logistics as filler', () => {
    expect(isFiller('Okay, great, thanks.')).toBe(true);
    expect(isFiller('Take your time.')).toBe(true);
    expect(isFiller('you disagreed with your manager.')).toBe(false);
  });
});

function interviewer(text: string, startSec: number, endSec = startSec + 1): Utterance {
  return { role: 'interviewer', text, startSec, endSec, completedAt: 0 };
}

function candidate(text: string, startSec: number): Utterance {
  return { role: 'candidate', text, startSec, endSec: startSec + 1, completedAt: 0 };
}

function setup(options: Partial<ConstructorParameters<typeof QuestionGate>[0]> = {}) {
  const fired: GatedQuestion[] = [];
  const gate = new QuestionGate({ onQuestion: (q) => fired.push(q), now: () => 1000, ...options });
  return { gate, fired };
}

describe('QuestionGate turns', () => {
  it('fires once per question and keeps earlier context from the same turn', async () => {
    const { gate, fired } = setup();
    await gate.observe(interviewer('I see you spent three years at Stripe.', 0, 2));
    await gate.observe(interviewer('What did you build there?', 2.5, 4));

    expect(fired).toEqual([
      expect.objectContaining({
        text: 'I see you spent three years at Stripe. What did you build there?',
        category: 'other',
        trigger: 'gate',
        via: 'heuristic',
      }),
    ]);
  });

  it('re-fires with the whole question when a pause cut it off', async () => {
    const { gate, fired } = setup();
    await gate.observe(interviewer('Tell me about a time', 0, 1));
    await gate.observe(interviewer('you disagreed with your manager.', 1.4, 3));

    expect(fired.map((q) => q.text)).toEqual([
      'Tell me about a time',
      'Tell me about a time you disagreed with your manager.',
    ]);
    expect(fired[1].category).toBe('behavioral');
  });

  it('does not re-fire a complete question for a remark or filler that follows', async () => {
    const { gate, fired } = setup();
    await gate.observe(interviewer('Tell me about a project you led recently.', 0, 2));
    await gate.observe(interviewer('Take your time.', 2.5, 3));
    await gate.observe(interviewer('We use a lot of Go here.', 3.5, 4.5));

    expect(fired).toHaveLength(1);
  });

  it('fires again for a new question in the same turn (the caller supersedes)', async () => {
    const { gate, fired } = setup();
    await gate.observe(interviewer('How would you design a URL shortener?', 0, 2));
    await gate.observe(interviewer('Actually, how would you make it scale to millions of users?', 3, 5));

    expect(fired).toHaveLength(2);
    expect(fired[1].category).toBe('system_design');
  });

  it('starts a new turn after the candidate speaks or after a long gap', async () => {
    const { gate, fired } = setup();
    await gate.observe(interviewer('Why did you pick Rust?', 0, 1));
    await gate.observe(candidate('Mostly for memory safety.', 2));
    await gate.observe(interviewer('How so?', 4, 4.5));
    await gate.observe(interviewer('What would you do differently?', 20, 21));

    expect(fired.map((q) => q.text)).toEqual(['Why did you pick Rust?', 'How so?', 'What would you do differently?']);
  });

  it('ignores non-questions', async () => {
    const { gate, fired } = setup();
    for (const [index, text] of ['Great, thanks.', 'Can you hear me okay?', 'Let me share my screen.'].entries()) {
      await gate.observe(interviewer(text, index * 2));
    }
    expect(fired).toHaveLength(0);
  });
});

describe('QuestionGate Answer now', () => {
  it('answers the current turn plus words still being spoken', () => {
    const { gate, fired } = setup();
    void gate.observe(interviewer('So for the next one.', 0));
    const question = gate.answerNow('walk me through a migration you ran');

    expect(question).toEqual(
      expect.objectContaining({ text: 'So for the next one. walk me through a migration you ran', trigger: 'manual' }),
    );
    expect(fired).toHaveLength(1);
  });

  it('repeats the last interviewer turn once the candidate has started answering', async () => {
    const { gate } = setup();
    await gate.observe(interviewer('Why this company?', 0));
    await gate.observe(candidate('Well, I have used your product for years.', 2));

    expect(gate.answerNow()?.text).toBe('Why this company?');
    expect(gate.answerNow('And why now?')?.text).toBe('And why now?');
  });

  it('returns null when there is nothing to answer', () => {
    const { gate, fired } = setup();
    expect(gate.answerNow()).toBeNull();
    expect(fired).toHaveLength(0);
  });
});

describe('QuestionGate classifier for unsure lines', () => {
  // A "?" but no question words: the heuristic can't tell, so it asks.
  const UNSURE = 'So you were the tech lead on that?';

  it('keeps the score in the unsure band for the fixture line', () => {
    expect(scoreUtterance(UNSURE).decision).toBe('unsure');
  });

  it('uses the classifier verdict and category', async () => {
    const classify = jest.fn().mockResolvedValue({ answer: true, category: 'technical' });
    const { gate, fired } = setup({ classify });
    await gate.observe(interviewer(UNSURE, 0));

    expect(classify).toHaveBeenCalledWith(UNSURE, expect.any(AbortSignal));
    expect(fired).toEqual([expect.objectContaining({ via: 'classifier', category: 'technical' })]);
  });

  it('skips when the classifier says no', async () => {
    const { gate, fired } = setup({ classify: jest.fn().mockResolvedValue({ answer: false, category: 'other' }) });
    await gate.observe(interviewer(UNSURE, 0));
    expect(fired).toHaveLength(0);
  });

  it('falls back to the heuristic when the classifier is too slow', async () => {
    jest.useFakeTimers();
    try {
      const classify = jest.fn(
        (_text: string, signal: AbortSignal) =>
          new Promise<null>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
      );
      const { gate, fired } = setup({ classify, classifierBudgetMs: 600 });
      const pending = gate.observe(interviewer(UNSURE, 0));
      await jest.advanceTimersByTimeAsync(600);
      await pending;

      expect(fired).toEqual([expect.objectContaining({ via: 'fallback' })]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('drops a classifier answer that arrives after a newer question fired', async () => {
    let resolveClassifier: (value: { answer: boolean; category: QuestionCategory }) => void = () => undefined;
    const classify = jest.fn(() => new Promise<{ answer: boolean; category: QuestionCategory }>((r) => (resolveClassifier = r)));
    const { gate, fired } = setup({ classify });

    const pending = gate.observe(interviewer(UNSURE, 0));
    await gate.observe(interviewer('Actually, tell me about your last project.', 1.5, 3));
    resolveClassifier({ answer: true, category: 'technical' });
    await pending;

    expect(fired.map((q) => q.via)).toEqual(['heuristic']);
  });
});
