jest.mock('@/lib/env', () => ({ env: {} }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));

import { env } from '@/lib/env';
import {
  DEFAULT_MODEL_SETTINGS,
  isAllowedModel,
  modelOptions,
  resolveModels,
  sessionModels,
  settingsFromRow,
} from '@/lib/answerModels';

const mutableEnv = env as Record<string, string | undefined>;

beforeEach(() => {
  delete mutableEnv.COPILOT_ANSWER_MODEL;
  delete mutableEnv.COPILOT_CODING_MODEL;
  process.env.OPENAI_API_KEY = 'test-openai';
  delete process.env.ANTHROPIC_API_KEY;
});

afterAll(() => {
  delete process.env.OPENAI_API_KEY;
});

describe('modelOptions', () => {
  it('offers only models whose provider has a key', () => {
    expect(modelOptions().map((option) => option.id)).toEqual(['gpt-4o-mini', 'gpt-4o']);
    process.env.ANTHROPIC_API_KEY = 'test-anthropic';
    expect(modelOptions().map((option) => option.id)).toEqual(['gpt-4o-mini', 'gpt-4o', 'claude-haiku-5-5', 'claude-sonnet-5-5']);
  });

  it('adds the server defaults when they are not in the list', () => {
    mutableEnv.COPILOT_ANSWER_MODEL = 'gpt-4.1-mini';
    expect(modelOptions().map((option) => option.id)).toContain('gpt-4.1-mini');
  });

  it('offers nothing without any key', () => {
    delete process.env.OPENAI_API_KEY;
    expect(modelOptions()).toEqual([]);
    expect(isAllowedModel('gpt-4o')).toBe(false);
  });
});

describe('resolveModels', () => {
  it('uses the server defaults when nothing is chosen', () => {
    expect(resolveModels(DEFAULT_MODEL_SETTINGS)).toEqual({
      answer: 'gpt-4o-mini',
      coding: 'gpt-4o-mini',
      temperature: 0.4,
      maxTokens: 700,
      words: 150,
    });
  });

  it('applies the user choices', () => {
    expect(
      resolveModels({ answerModel: 'gpt-4o', codingModel: null, style: 'precise', length: 'short' }),
    ).toEqual({ answer: 'gpt-4o', coding: 'gpt-4o', temperature: 0.2, maxTokens: 450, words: 80 });
  });

  it("keeps the server's coding model unless the user picks one", () => {
    mutableEnv.COPILOT_CODING_MODEL = 'gpt-4o';
    expect(resolveModels({ ...DEFAULT_MODEL_SETTINGS, answerModel: 'gpt-4o-mini' }).coding).toBe('gpt-4o');
    expect(resolveModels({ ...DEFAULT_MODEL_SETTINGS, codingModel: 'gpt-4o-mini' }).coding).toBe('gpt-4o-mini');
  });

  it('ignores a saved model the server can no longer call', () => {
    expect(resolveModels({ ...DEFAULT_MODEL_SETTINGS, answerModel: 'claude-sonnet-5-5' }).answer).toBe('gpt-4o-mini');
  });
});

describe('settingsFromRow', () => {
  it('maps a saved row', () => {
    expect(settingsFromRow({ model: 'gpt-4o', coding_model: null, temperature: '0.7', answer_length: 'detailed' })).toEqual({
      answerModel: 'gpt-4o',
      codingModel: null,
      style: 'creative',
      length: 'detailed',
    });
  });

  it('falls back on unknown values', () => {
    expect(settingsFromRow({ model: '', coding_model: '', temperature: null, answer_length: 'huge' })).toEqual(
      DEFAULT_MODEL_SETTINGS,
    );
    expect(settingsFromRow(null)).toEqual(DEFAULT_MODEL_SETTINGS);
  });
});

describe('sessionModels', () => {
  it('reads the models frozen into a session', () => {
    const models = { answer: 'gpt-4o', coding: 'gpt-4o', temperature: 0.2, maxTokens: 450, words: 80 };
    expect(sessionModels({ models })).toEqual(models);
  });

  it('uses the defaults for sessions started before this setting existed', () => {
    expect(sessionModels({})).toEqual(resolveModels());
    expect(sessionModels(null)).toEqual(resolveModels());
  });
});
