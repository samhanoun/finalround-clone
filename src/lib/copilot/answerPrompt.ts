import { renderContextPack, type ContextPack } from './contextPack';
import type { QuestionCategory } from './questionGate';

export type TranscriptLine = { speaker: 'interviewer' | 'candidate'; text: string };

const MODE_HINTS: Record<string, string> = {
  coding: 'This is a coding interview: expect algorithm, data-structure and debugging questions.',
  phone: 'This is a phone screen: keep answers brief and conversational.',
  video: 'This is a video interview: answers should sound natural and confident.',
};

const CATEGORY_HINTS: Record<QuestionCategory, string> = {
  behavioral: 'behavioral (use one real example from the context, in STAR order)',
  technical: 'technical (explain directly, then one concrete detail or trade-off)',
  coding: 'coding (approach, then complexity, then code)',
  system_design: 'system design (requirements, components, data, scaling, trade-offs)',
  other: 'general',
};

/**
 * Stable system prompt blocks for a session: the instructions, then the
 * candidate context. Both stay identical for every question in the session,
 * so the provider can reuse its cache of this prefix.
 */
export function answerSystemBlocks({
  mode,
  contextPack,
  noFullCode,
}: {
  mode: string;
  contextPack: ContextPack | null;
  noFullCode: boolean;
}): string[] {
  const instructions = [
    'You are helping a job candidate during a live interview. The interviewer has just asked something;',
    'write what the candidate can say in reply. They will read it while talking, so it must be fast to scan.',
    '',
    'FORMAT',
    '- Speak as the candidate, in the first person.',
    '- First line: one sentence the candidate can say out loud right away.',
    '- Then 3 to 5 short bullet points starting with "- ", each a few words to a short sentence.',
    '- Stay under about 150 words unless the question needs code.',
    '- Reply in the language the interviewer is using.',
    '',
    'FACTS',
    '- Use only facts about the candidate found in the candidate context or in what the candidate has said in the transcript.',
    '- Never invent employers, titles, projects, numbers or dates. If nothing in the context fits, answer with how the candidate',
    '  would approach it, or point to transferable experience in general terms, without making up specifics.',
    '',
    'BY QUESTION TYPE',
    '- Behavioral: one example in STAR order (situation, task, action, result); end on the result.',
    '- Technical: the direct explanation first, then a concrete detail, example or trade-off.',
    noFullCode
      ? '- Coding: the approach, then time and space complexity, then hints for the key steps. Do not write a complete solution.'
      : '- Coding: the approach, then time and space complexity, then a short solution in one fenced code block.',
    '- System design: clarify requirements, then the main components and data flow, storage, then scaling and trade-offs.',
    '- Anything else: answer directly.',
    MODE_HINTS[mode] ? `\n${MODE_HINTS[mode]}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return [instructions, renderContextPack(contextPack)];
}

/** The per-question message: recent conversation, then the question. */
export function answerUserMessage({
  question,
  category,
  recentTranscript,
}: {
  question: string;
  category: QuestionCategory;
  recentTranscript: TranscriptLine[];
}): string {
  const conversation = recentTranscript.length
    ? recentTranscript.map((line) => `${line.speaker}: ${line.text}`).join('\n')
    : '(nothing yet)';
  return [
    'Recent conversation (oldest first):',
    conversation,
    '',
    `Question type: ${CATEGORY_HINTS[category]}`,
    `Interviewer's question: ${question}`,
  ].join('\n');
}
