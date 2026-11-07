/** Answer length and writing style choices (Settings → Answer model). Safe to import in the browser. */

export const ANSWER_LENGTHS = {
  short: { label: 'Short', words: 80, maxTokens: 450 },
  standard: { label: 'Standard', words: 150, maxTokens: 700 },
  detailed: { label: 'Detailed', words: 250, maxTokens: 1000 },
} as const;
export type AnswerLength = keyof typeof ANSWER_LENGTHS;
export const ANSWER_LENGTH_IDS = Object.keys(ANSWER_LENGTHS) as AnswerLength[];

/** Writing style → temperature for live answers. */
export const ANSWER_STYLES = {
  precise: { label: 'Precise', temperature: 0.2 },
  balanced: { label: 'Balanced', temperature: 0.4 },
  creative: { label: 'Creative', temperature: 0.7 },
} as const;
export type AnswerStyle = keyof typeof ANSWER_STYLES;
export const ANSWER_STYLE_IDS = Object.keys(ANSWER_STYLES) as AnswerStyle[];

export function styleForTemperature(temperature: number | null | undefined): AnswerStyle {
  if (typeof temperature !== 'number' || Number.isNaN(temperature)) return 'balanced';
  if (temperature <= 0.3) return 'precise';
  if (temperature >= 0.6) return 'creative';
  return 'balanced';
}

/** What the user saved; a null model means "the server default". */
export type ModelSettings = {
  answerModel: string | null;
  codingModel: string | null;
  style: AnswerStyle;
  length: AnswerLength;
};

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  answerModel: null,
  codingModel: null,
  style: 'balanced',
  length: 'standard',
};

export type ModelOption = { id: string; label: string; note: string; provider: 'openai' | 'anthropic' };
