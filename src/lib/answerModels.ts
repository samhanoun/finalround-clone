import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { isProviderConfigured, providerForModel } from '@/lib/llmRouter';
import {
  ANSWER_LENGTHS,
  ANSWER_LENGTH_IDS,
  ANSWER_STYLES,
  DEFAULT_MODEL_SETTINGS,
  styleForTemperature,
  type AnswerLength,
  type ModelOption,
  type ModelSettings,
} from '@/lib/answerStyle';

export { DEFAULT_MODEL_SETTINGS, type ModelOption, type ModelSettings };

/**
 * Settings → Answer model: which model writes the user's answers, and how.
 * - Live copilot: resolved once at session start and frozen into the session
 *   (metadata.models), so the answer route never reads settings on the hot path.
 * - Practice, reports, cover letters and tailored résumés: the answer model.
 * Only models this server can call are offered; anything else falls back to
 * the server defaults (COPILOT_ANSWER_MODEL / COPILOT_CODING_MODEL).
 */

const KNOWN_MODELS: Array<Omit<ModelOption, 'provider'>> = [
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', note: 'Fastest. Good for most spoken answers.' },
  { id: 'gpt-4o', label: 'GPT-4o', note: 'Stronger reasoning and coding, a little slower.' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fast, with natural wording.' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Strongest for coding and system design, slower.' },
];

/** What a request actually uses. */
export type ResolvedModels = {
  answer: string;
  coding: string;
  temperature: number;
  maxTokens: number;
  words: number;
};

export function serverDefaultModels(): { answer: string; coding: string } {
  const answer = env.COPILOT_ANSWER_MODEL ?? 'gpt-4o-mini';
  return { answer, coding: env.COPILOT_CODING_MODEL ?? answer };
}

/** Models this server can call right now (its provider has a key). */
export function modelOptions(): ModelOption[] {
  const defaults = serverDefaultModels();
  const options: Array<Omit<ModelOption, 'provider'>> = [...KNOWN_MODELS];
  for (const id of [defaults.answer, defaults.coding]) {
    if (!options.some((option) => option.id === id)) options.push({ id, label: id, note: 'Set by this server.' });
  }
  return options.flatMap((option) => {
    const provider = providerForModel(option.id);
    return provider && isProviderConfigured(provider) ? [{ ...option, provider }] : [];
  });
}

/** What Settings → Answer model offers. */
export function modelChoices() {
  const defaults = serverDefaultModels();
  return {
    options: modelOptions(),
    defaults: { ...defaults, codingIsSeparate: Boolean(env.COPILOT_CODING_MODEL) },
  };
}

export function isAllowedModel(id: string): boolean {
  return modelOptions().some((option) => option.id === id);
}

export function resolveModels(settings: ModelSettings = DEFAULT_MODEL_SETTINGS): ResolvedModels {
  const defaults = serverDefaultModels();
  const allowed = new Set(modelOptions().map((option) => option.id));
  const chosenAnswer = settings.answerModel && allowed.has(settings.answerModel) ? settings.answerModel : null;
  const chosenCoding = settings.codingModel && allowed.has(settings.codingModel) ? settings.codingModel : null;
  const answer = chosenAnswer ?? defaults.answer;
  // No coding choice: the server's coding model if it has one, else the answer model.
  const coding = chosenCoding ?? (env.COPILOT_CODING_MODEL ? defaults.coding : answer);
  const length = ANSWER_LENGTHS[settings.length] ?? ANSWER_LENGTHS.standard;
  const style = ANSWER_STYLES[settings.style] ?? ANSWER_STYLES.balanced;
  return { answer, coding, temperature: style.temperature, maxTokens: length.maxTokens, words: length.words };
}

type SettingsRow = {
  model: string | null;
  coding_model: string | null;
  temperature: number | string | null;
  answer_length: string | null;
};

export function settingsFromRow(row: SettingsRow | null | undefined): ModelSettings {
  if (!row) return DEFAULT_MODEL_SETTINGS;
  const length = ANSWER_LENGTH_IDS.includes(row.answer_length as AnswerLength) ? (row.answer_length as AnswerLength) : 'standard';
  return {
    answerModel: row.model || null,
    codingModel: row.coding_model || null,
    style: styleForTemperature(row.temperature === null ? null : Number(row.temperature)),
    length,
  };
}

/** The user's saved settings (RLS lets users read their own row); defaults on any error. */
export async function loadModelSettings(supabase: SupabaseClient, userId: string): Promise<ModelSettings> {
  try {
    const { data, error } = await supabase
      .from('llm_settings')
      .select('model, coding_model, temperature, answer_length')
      .eq('user_id', userId)
      .maybeSingle<SettingsRow>();
    return error ? DEFAULT_MODEL_SETTINGS : settingsFromRow(data);
  } catch {
    return DEFAULT_MODEL_SETTINGS;
  }
}

export async function userModels(supabase: SupabaseClient, userId: string): Promise<ResolvedModels> {
  return resolveModels(await loadModelSettings(supabase, userId));
}

/** The models frozen into a live session at start; the defaults for older sessions. */
export function sessionModels(metadata: Record<string, unknown> | null | undefined): ResolvedModels {
  const saved = metadata?.models as Partial<ResolvedModels> | undefined;
  const fallback = resolveModels();
  if (!saved || typeof saved !== 'object') return fallback;
  return {
    answer: typeof saved.answer === 'string' && saved.answer ? saved.answer : fallback.answer,
    coding: typeof saved.coding === 'string' && saved.coding ? saved.coding : fallback.coding,
    temperature: typeof saved.temperature === 'number' ? saved.temperature : fallback.temperature,
    maxTokens: typeof saved.maxTokens === 'number' ? saved.maxTokens : fallback.maxTokens,
    words: typeof saved.words === 'number' ? saved.words : fallback.words,
  };
}
