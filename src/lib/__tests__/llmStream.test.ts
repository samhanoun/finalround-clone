import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { LLMUnavailableError, providerForModel, streamChat } from '@/lib/llmRouter';

async function* chunks<T>(items: T[]) {
  for (const item of items) yield item;
}

async function collect(stream: AsyncGenerator<string>) {
  const out: string[] = [];
  for await (const text of stream) out.push(text);
  return out;
}

describe('providerForModel', () => {
  it('routes by model id', () => {
    expect(providerForModel('gpt-4o-mini')).toBe('openai');
    expect(providerForModel('o4-mini')).toBe('openai');
    expect(providerForModel('claude-haiku-5-5')).toBe('anthropic');
    expect(providerForModel('gemini-2.0-flash')).toBeNull();
  });
});

describe('streamChat', () => {
  const base = {
    system: ['Stable instructions.', 'Candidate context.'],
    messages: [{ role: 'user' as const, content: 'Why this role?' }],
  };

  it('streams OpenAI deltas with the system blocks as one stable prefix', async () => {
    const create = jest.fn().mockResolvedValue(
      chunks([{ choices: [{ delta: { content: 'I ' } }] }, { choices: [{ delta: {} }] }, { choices: [{ delta: { content: 'led it.' } }] }]),
    );
    const openai = { chat: { completions: { create } } } as unknown as OpenAI;
    const signal = new AbortController().signal;

    const out = await collect(streamChat({ ...base, model: 'gpt-4o-mini', temperature: 0.4, signal }, { openai }));

    expect(out).toEqual(['I ', 'led it.']);
    const [params, options] = create.mock.calls[0];
    expect(params).toMatchObject({
      model: 'gpt-4o-mini',
      stream: true,
      temperature: 0.4,
      max_completion_tokens: 700,
      messages: [
        { role: 'system', content: 'Stable instructions.\n\nCandidate context.' },
        { role: 'user', content: 'Why this role?' },
      ],
    });
    expect(options).toMatchObject({ signal, maxRetries: 0 });
  });

  it('leaves temperature out for reasoning models', async () => {
    const create = jest.fn().mockResolvedValue(chunks([]));
    const openai = { chat: { completions: { create } } } as unknown as OpenAI;
    await collect(streamChat({ ...base, model: 'o4-mini', temperature: 0.4 }, { openai }));
    expect(create.mock.calls[0][0]).not.toHaveProperty('temperature');
  });

  it('streams Anthropic text deltas and marks the last system block for caching', async () => {
    const create = jest.fn().mockResolvedValue(
      chunks([
        { type: 'message_start' },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Sure. ' } },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{}' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Here is how.' } },
      ]),
    );
    const anthropic = { messages: { create } } as unknown as Anthropic;

    const out = await collect(streamChat({ ...base, model: 'claude-haiku-5-5' }, { anthropic }));

    expect(out).toEqual(['Sure. ', 'Here is how.']);
    expect(create.mock.calls[0][0]).toMatchObject({
      model: 'claude-haiku-5-5',
      stream: true,
      system: [
        { type: 'text', text: 'Stable instructions.' },
        { type: 'text', text: 'Candidate context.', cache_control: { type: 'ephemeral' } },
      ],
    });
    expect(create.mock.calls[0][0].system[0]).not.toHaveProperty('cache_control');
  });

  it('sends an image part in each provider\'s format', async () => {
    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'Solve this.' },
          { type: 'image' as const, mediaType: 'image/jpeg' as const, data: 'AAAA' },
        ],
      },
    ];

    const openaiCreate = jest.fn().mockResolvedValue(chunks([]));
    const openai = { chat: { completions: { create: openaiCreate } } } as unknown as OpenAI;
    await collect(streamChat({ ...base, model: 'gpt-4o-mini', messages }, { openai }));
    expect(openaiCreate.mock.calls[0][0].messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Solve this.' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA', detail: 'high' } },
      ],
    });

    const anthropicCreate = jest.fn().mockResolvedValue(chunks([]));
    const anthropic = { messages: { create: anthropicCreate } } as unknown as Anthropic;
    await collect(streamChat({ ...base, model: 'claude-haiku-5-5', messages }, { anthropic }));
    expect(anthropicCreate.mock.calls[0][0].messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'Solve this.' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
      ],
    });
  });

  it('fails clearly without a key or a known provider', async () => {
    const saved = { openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY };
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(collect(streamChat({ ...base, model: 'gpt-4o-mini' }))).rejects.toBeInstanceOf(LLMUnavailableError);
      await expect(collect(streamChat({ ...base, model: 'claude-haiku-5-5' }))).rejects.toBeInstanceOf(LLMUnavailableError);
      await expect(collect(streamChat({ ...base, model: 'mystery-1' }))).rejects.toThrow('No provider');
    } finally {
      if (saved.openai !== undefined) process.env.OPENAI_API_KEY = saved.openai;
      if (saved.anthropic !== undefined) process.env.ANTHROPIC_API_KEY = saved.anthropic;
    }
  });
});
