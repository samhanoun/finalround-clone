import { z } from 'zod';
import { env } from '@/lib/env';
import { streamChat, type StreamChatOptions } from '@/lib/llmRouter';
import { renderContextPack, type ContextPack } from '@/lib/copilot/contextPack';

/**
 * AI practice interviews: the model plays the interviewer (writes the
 * questions), then a coach (scores each answer). The final report reuses
 * /api/interviews/[id]/report.
 */

export const PRACTICE_TYPES = ['behavioral', 'technical', 'situational', 'mixed'] as const;
export const PRACTICE_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export const PRACTICE_LENGTHS = [3, 5, 8] as const;

export type PracticeType = (typeof PRACTICE_TYPES)[number];
export type PracticeDifficulty = (typeof PRACTICE_DIFFICULTIES)[number];
export type QuestionType = 'behavioral' | 'technical' | 'situational' | 'general';

export const PracticeSetupSchema = z.object({
  role: z.string().trim().min(1).max(120),
  company: z.string().trim().max(120).optional(),
  type: z.enum(PRACTICE_TYPES).default('behavioral'),
  difficulty: z.enum(PRACTICE_DIFFICULTIES).default('medium'),
  count: z.union([z.literal(3), z.literal(5), z.literal(8)]).default(5),
  resumeDocumentId: z.string().uuid().optional(),
  jobDescription: z.string().max(20_000).optional(),
});
export type PracticeSetup = z.infer<typeof PracticeSetupSchema>;

/** Stored on interview_sessions.meta.practice (without the job text, which lives in the context pack). */
export type StoredPracticeSetup = Omit<PracticeSetup, 'jobDescription' | 'resumeDocumentId'> & { hasResume: boolean; hasJob: boolean };

export type GeneratedQuestion = { text: string; type: QuestionType; difficulty: PracticeDifficulty };

export type AnswerFeedback = {
  /** 1–10. */
  score: number;
  verdict: string;
  strengths: string[];
  improvements: string[];
  /** What a stronger answer would cover, as short points. */
  stronger_answer: string[];
};

/** Marks the task so the e2e fake model can answer each kind of request. */
export const TASK_QUESTIONS = 'TASK: practice_questions';
export const TASK_FEEDBACK = 'TASK: practice_feedback';

export function practiceModel(): string {
  return env.COPILOT_ANSWER_MODEL ?? 'gpt-4o-mini';
}

/** Runs a chat request to completion. */
export async function completeChat(options: StreamChatOptions): Promise<string> {
  let text = '';
  for await (const piece of streamChat(options)) text += piece;
  return text;
}

/** The first JSON object in a model reply (models sometimes wrap it in prose or a code fence). */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const TYPE_GUIDE: Record<PracticeType, string> = {
  behavioral: 'Behavioral questions about past situations: leadership, conflict, failure, ownership, influence.',
  technical: 'Technical questions for the role: fundamentals, trade-offs, debugging, and one design or problem-solving question.',
  situational: 'Hypothetical "what would you do if" scenarios the role really meets.',
  mixed: 'A realistic mix: open with a warm-up, then behavioral, technical and situational questions.',
};

const DIFFICULTY_GUIDE: Record<PracticeDifficulty, string> = {
  easy: 'Entry-level depth. Straightforward, one idea per question.',
  medium: 'Mid-level depth. Expect specifics, trade-offs and measurable outcomes.',
  hard: 'Senior depth. Ambiguous problems, scale, cross-team influence and hard follow-up angles.',
};

function target(setup: Pick<PracticeSetup, 'role' | 'company'>): string {
  return setup.company ? `${setup.role} at ${setup.company}` : setup.role;
}

export function questionsRequest(setup: PracticeSetup, pack: ContextPack | null): Pick<StreamChatOptions, 'system' | 'messages'> {
  return {
    system: [
      [
        TASK_QUESTIONS,
        'You are an experienced hiring manager preparing a mock interview.',
        'Write questions a real interviewer for this role would ask. Make them specific to the role, and to the',
        'candidate context when there is any, so they are not generic. One question per item, no numbering,',
        'no multi-part questions, each under 40 words.',
        'Reply with JSON only, in this shape:',
        '{"questions":[{"text":"...","type":"behavioral|technical|situational|general","difficulty":"easy|medium|hard"}]}',
      ].join('\n'),
      renderContextPack(pack),
    ],
    messages: [
      {
        role: 'user',
        content: [
          `Role: ${target(setup)}`,
          `Interview type: ${setup.type}. ${TYPE_GUIDE[setup.type]}`,
          `Difficulty: ${setup.difficulty}. ${DIFFICULTY_GUIDE[setup.difficulty]}`,
          `Number of questions: ${setup.count}`,
        ].join('\n'),
      },
    ],
  };
}

const QUESTION_TYPES: QuestionType[] = ['behavioral', 'technical', 'situational', 'general'];

export function parseQuestions(text: string, setup: Pick<PracticeSetup, 'type' | 'difficulty' | 'count'>): GeneratedQuestion[] {
  const raw = extractJsonObject(text) as { questions?: unknown } | null;
  const list = Array.isArray(raw?.questions) ? raw.questions : [];
  const fallbackType: QuestionType = setup.type === 'mixed' ? 'general' : setup.type;
  const seen = new Set<string>();
  const questions: GeneratedQuestion[] = [];
  for (const item of list) {
    const entry = (typeof item === 'string' ? { text: item } : item) as Record<string, unknown> | null;
    const questionText = typeof entry?.text === 'string' ? entry.text.trim().replace(/^\d+[.)]\s*/, '') : '';
    if (questionText.length < 8 || seen.has(questionText.toLowerCase())) continue;
    seen.add(questionText.toLowerCase());
    questions.push({
      text: questionText.slice(0, 500),
      type: QUESTION_TYPES.includes(entry?.type as QuestionType) ? (entry?.type as QuestionType) : fallbackType,
      difficulty: PRACTICE_DIFFICULTIES.includes(entry?.difficulty as PracticeDifficulty)
        ? (entry?.difficulty as PracticeDifficulty)
        : setup.difficulty,
    });
    if (questions.length >= setup.count) break;
  }
  return questions;
}

export function feedbackRequest(
  question: { text: string; type: string; difficulty: string },
  answer: string,
  setup: Pick<PracticeSetup, 'role' | 'company'>,
  pack: ContextPack | null,
): Pick<StreamChatOptions, 'system' | 'messages'> {
  return {
    system: [
      [
        TASK_FEEDBACK,
        'You are an interview coach giving feedback on one answer from a mock interview.',
        'Judge it the way the interviewer would: does it answer the question, is it specific (names, numbers,',
        'outcomes), is it well structured (for behavioral questions: situation, task, action, result), and is it',
        'the right length to say aloud. Be direct and kind. Quote the candidate where it helps.',
        'Score 1–10: 1–3 misses the question, 4–5 vague, 6–7 solid, 8–9 strong, 10 exceptional.',
        'Only use facts the candidate gave or the candidate context below; never invent experience for them.',
        'Reply with JSON only, in this shape:',
        '{"score":7,"verdict":"one sentence","strengths":["..."],"improvements":["..."],"stronger_answer":["short point"]}',
      ].join('\n'),
      renderContextPack(pack),
    ],
    messages: [
      {
        role: 'user',
        content: [
          `Role: ${target(setup)}`,
          `Question (${question.type}, ${question.difficulty}): ${question.text}`,
          'Answer:',
          answer,
        ].join('\n'),
      },
    ],
  };
}

function stringList(value: unknown, max = 4): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

export function parseFeedback(text: string): AnswerFeedback | null {
  const raw = extractJsonObject(text) as Record<string, unknown> | null;
  if (!raw) return null;
  const score = Number(raw.score);
  if (!Number.isFinite(score)) return null;
  return {
    score: Math.max(1, Math.min(10, Math.round(score))),
    verdict: typeof raw.verdict === 'string' ? raw.verdict.trim().slice(0, 300) : '',
    strengths: stringList(raw.strengths),
    improvements: stringList(raw.improvements),
    stronger_answer: stringList(raw.stronger_answer, 5),
  };
}
