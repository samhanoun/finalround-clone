import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';
import { jsonError } from '@/lib/api';
import { llmProvider, requireEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { sanitizeCopilotText } from '@/lib/copilotSecurity';

interface Params {
  params: Promise<{ id: string }>;
}

const BodySchema = z.object({
  eventType: z.enum(['transcript', 'system']).default('transcript'),
  speaker: z.enum(['interviewer', 'candidate', 'system']).default('interviewer'),
  text: z.string().min(1).max(4000),
  autoSuggest: z.boolean().optional(),
});

type EventPayload = Record<string, unknown>;

function buildSuggestionPrompt(args: {
  mode: string;
  transcriptText: string;
  latestQuestion: string;
}) {
  const modeHint =
    args.mode === 'coding'
      ? 'Focus on technical reasoning, constraints, edge cases, and complexity.'
      : args.mode === 'phone'
        ? 'Focus on concise and clear phone-screen style responses.'
        : args.mode === 'video'
          ? 'Focus on structured, confident video-interview responses.'
          : 'Focus on behavioral interview responses.';

  return [
    {
      role: 'system' as const,
      content:
        'You are an interview copilot. Return practical interview guidance only. Never invent user experience details not in context. Keep output concise and immediately usable.',
    },
    {
      role: 'user' as const,
      content: `Interview mode: ${args.mode}\n${modeHint}\n\nRecent transcript:\n${args.transcriptText}\n\nLatest interviewer question:\n${args.latestQuestion}\n\nReturn JSON with this exact shape:\n{\n  "short_answer": "<= 90 words",\n  "talking_points": ["bullet1", "bullet2", "bullet3"],\n  "follow_up": "one short clarifying follow-up user can ask if needed"\n}`,
    },
  ];
}

export async function POST(req: NextRequest, { params }: Params) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `copilot:events:${ip}`, limit: 90, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const parse = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const { id } = await params;
  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonError(401, 'unauthorized');

  const { data: session, error: sessionError } = await supabase
    .from('copilot_sessions')
    .select('id, user_id, status, metadata')
    .eq('id', id)
    .single<{ id: string; user_id: string; status: string; metadata: Record<string, unknown> | null }>();

  if (sessionError || !session) return jsonError(404, 'session_not_found');
  if (session.user_id !== userData.user.id) return jsonError(403, 'forbidden');
  if (session.status !== 'active') return jsonError(409, 'session_not_active');

  const cleanedInput = sanitizeCopilotText(parse.data.text);

  const payload: EventPayload = {
    speaker: parse.data.speaker,
    text: cleanedInput.sanitized,
    mode: typeof session.metadata?.mode === 'string' ? session.metadata.mode : 'general',
    security: {
      redactions: cleanedInput.redactions,
      prompt_injection: cleanedInput.hasPromptInjection,
    },
  };

  const { data: createdEvent, error: insertError } = await supabase
    .from('copilot_events')
    .insert({
      session_id: id,
      user_id: userData.user.id,
      event_type: parse.data.eventType,
      payload,
    })
    .select('id, event_type, payload, created_at')
    .single();

  if (insertError || !createdEvent) return jsonError(500, 'db_error', insertError);

  const shouldSuggest =
    parse.data.autoSuggest !== false &&
    parse.data.eventType === 'transcript' &&
    parse.data.speaker === 'interviewer' &&
    !cleanedInput.hasPromptInjection;

  if (!shouldSuggest) {
    return NextResponse.json({
      event: createdEvent,
      suggestion: null,
      blocked: cleanedInput.hasPromptInjection,
      redactions: cleanedInput.redactions,
    }, { status: 201 });
  }

  const { data: transcriptRows } = await supabase
    .from('copilot_events')
    .select('id, payload, created_at')
    .eq('session_id', id)
    .eq('event_type', 'transcript')
    .order('created_at', { ascending: false })
    .limit(16);

  const ordered = (transcriptRows ?? []).slice().reverse();
  const transcriptText = ordered
    .map((row) => {
      const p = row.payload as EventPayload;
      const speaker = typeof p.speaker === 'string' ? p.speaker : 'unknown';
      const text = typeof p.text === 'string' ? p.text : '';
      return `${speaker}: ${text}`;
    })
    .join('\n');

  const mode = typeof payload.mode === 'string' ? payload.mode : 'general';

  try {
    if (llmProvider() !== 'openai') return jsonError(400, 'unsupported_provider');

    const client = new OpenAI({ apiKey: requireEnv('OPENAI_API_KEY') });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: buildSuggestionPrompt({
        mode,
        transcriptText: transcriptText || `${parse.data.speaker}: ${cleanedInput.sanitized}`,
        latestQuestion: cleanedInput.sanitized,
      }),
    });

    const content = completion.choices[0]?.message?.content ?? '{}';

    let parsedSuggestion: { short_answer?: string; talking_points?: string[]; follow_up?: string } = {};
    try {
      parsedSuggestion = JSON.parse(content) as { short_answer?: string; talking_points?: string[]; follow_up?: string };
    } catch {
      parsedSuggestion = { short_answer: content };
    }

    const suggestionPayload: EventPayload = {
      category: 'answer',
      text: parsedSuggestion.short_answer ?? 'No suggestion generated.',
      based_on_event_id: createdEvent.id,
      mode,
    };

    if (Array.isArray(parsedSuggestion.talking_points)) {
      suggestionPayload.talking_points = parsedSuggestion.talking_points.slice(0, 6);
    }

    if (typeof parsedSuggestion.follow_up === 'string') {
      suggestionPayload.follow_up = parsedSuggestion.follow_up;
    }

    const { data: suggestionEvent, error: suggestionError } = await supabase
      .from('copilot_events')
      .insert({
        session_id: id,
        user_id: userData.user.id,
        event_type: 'suggestion',
        payload: suggestionPayload,
      })
      .select('id, event_type, payload, created_at')
      .single();

    if (suggestionError) return jsonError(500, 'db_error', suggestionError);

    return NextResponse.json({ event: createdEvent, suggestion: suggestionEvent }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'llm_failed';
    const { data: fallbackSuggestion } = await supabase
      .from('copilot_events')
      .insert({
        session_id: id,
        user_id: userData.user.id,
        event_type: 'suggestion',
        payload: {
          category: 'system',
          text: 'Suggestion generation is temporarily unavailable. Try rephrasing the question in one short sentence.',
          based_on_event_id: createdEvent.id,
          mode,
          error: msg,
        },
      })
      .select('id, event_type, payload, created_at')
      .single();

    return NextResponse.json(
      {
        event: createdEvent,
        suggestion: fallbackSuggestion ?? null,
      },
      { status: 201 },
    );
  }
}
