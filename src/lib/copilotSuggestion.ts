import type OpenAI from 'openai';

export type SuggestionPromptInput = {
  mode: string;
  transcriptText: string;
  latestQuestion: string;
};

export type ParsedSuggestion = {
  shortAnswer: string;
  talkingPoints: string[];
  followUp?: string;
  complexity?: string;
  edgeCases?: string[];
  checklist?: string[];
  structured: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function asStringArray(value: unknown, maxItems = 6): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

export function buildSuggestionPrompt(args: SuggestionPromptInput): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const modeHint =
    args.mode === 'coding'
      ? 'Focus on technical reasoning, constraints, edge cases, and complexity.'
      : args.mode === 'phone'
        ? 'Focus on concise and clear phone-screen style responses.'
        : args.mode === 'video'
          ? 'Focus on structured, confident video-interview responses.'
          : 'Focus on behavioral interview responses.';

  const codingFields =
    args.mode === 'coding'
      ? ',\n  "complexity": "time/space complexity summary in one short line",\n  "edge_cases": ["edge case 1", "edge case 2"],\n  "checklist": ["step 1", "step 2", "step 3"]'
      : '';

  return [
    {
      role: 'system',
      content:
        'You are an interview copilot. Return practical interview guidance only. Never invent user experience details not in context. Keep output concise and immediately usable.',
    },
    {
      role: 'user',
      content: `Interview mode: ${args.mode}\n${modeHint}\n\nRecent transcript:\n${args.transcriptText}\n\nLatest interviewer question:\n${args.latestQuestion}\n\nReturn JSON with this exact shape:\n{\n  "short_answer": "<= 90 words",\n  "talking_points": ["bullet1", "bullet2", "bullet3"],\n  "follow_up": "one short clarifying follow-up user can ask if needed"${codingFields}\n}`,
    },
  ];
}

export function parseSuggestionContent(content: string, mode: string): ParsedSuggestion {
  let parsed: Record<string, unknown> = {};

  try {
    const candidate = JSON.parse(content) as unknown;
    if (isRecord(candidate)) parsed = candidate;
  } catch {
    parsed = { short_answer: content };
  }

  const shortAnswer = asString(parsed.short_answer) ?? asString(content) ?? 'No suggestion generated.';
  const talkingPoints = asStringArray(parsed.talking_points);
  const followUp = asString(parsed.follow_up);

  const complexity = mode === 'coding' ? asString(parsed.complexity) : undefined;
  const edgeCases = mode === 'coding' ? asStringArray(parsed.edge_cases, 8) : [];
  const checklist = mode === 'coding' ? asStringArray(parsed.checklist, 10) : [];

  const structured: Record<string, unknown> = {
    short_answer: shortAnswer,
    talking_points: talkingPoints,
  };

  if (followUp) structured.follow_up = followUp;
  if (complexity) structured.complexity = complexity;
  if (edgeCases.length > 0) structured.edge_cases = edgeCases;
  if (checklist.length > 0) structured.checklist = checklist;

  return {
    shortAnswer,
    talkingPoints,
    followUp,
    complexity,
    edgeCases,
    checklist,
    structured,
  };
}
