import { NextResponse, type NextRequest } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';
import { llmProvider, requireEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { normalizeMockInterviewReport } from '@/lib/mockInterviewReport';

const GenerateReportSchema = z.object({
  mode: z.enum(['general', 'behavioral', 'technical', 'situational']).default('general'),
});

// System prompt for report generation
const REPORT_SYSTEM_PROMPT = `You are an expert interview coach. Analyze the candidate's responses to generate a comprehensive mock interview report.

Evaluate each response on four key dimensions:
1. CLARITY: How clearly did the candidate communicate? (1-5)
2. CONFIDENCE: How confident did the candidate sound? (1-5)
3. RELEVANCE: How relevant was the answer to the question? (1-5)
4. STRUCTURE: How well-organized was the response? (1-5)

For each dimension, provide:
- score: 1-5 integer
- evidence: Specific quote or observation supporting the score
- recommendation: Actionable improvement tip

Finally, generate:
- overall_score: 0-100 weighted average
- hiring_signal: one of [strong_no_hire, no_hire, lean_no_hire, lean_hire, hire, strong_hire]
- summary: 2-3 sentence overall assessment
- strengths: Array of 3-5 specific strengths
- weaknesses: Array of 3-5 specific areas for improvement
- next_steps: Array of 3-5 prioritized action items (P1, P2, P3...)

Output ONLY valid JSON matching this exact structure. No markdown, no explanation.`;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `interview_report:post:${ip}`, limit: 15, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await ctx.params;
  const parse = GenerateReportSchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const mode = parse.data.mode;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  // Verify session belongs to user
  const { data: session } = await supabase
    .from('interview_sessions')
    .select('*')
    .eq('id', id)
    .eq('user_id', userData.user.id)
    .single();

  if (!session) return jsonError(404, 'not_found');

  // Get questions and responses
  const { data: questions } = await supabase
    .from('interview_questions')
    .select('*')
    .eq('session_id', id)
    .order('order_index', { ascending: true });

  if (!questions || questions.length === 0) {
    return jsonError(400, 'no_questions', { message: 'No questions to generate report from' });
  }

  // Build prompt with Q&A
  const qaList = questions
    .map((q, i) => {
      const difficulty = q.difficulty || 'medium';
      const type = q.question_type || 'general';
      return `Q${i + 1} [${type}, ${difficulty}]: ${q.question_text}\nA: ${q.response_text || '(no response)'}`;
    })
    .join('\n\n');

  const userPrompt = `Interview Mode: ${mode}\n\nInterview Q&A:\n${qaList}\n\nGenerate the report in JSON format.`;

  const provider = llmProvider();
  if (provider !== 'openai') return jsonError(500, 'unsupported_provider', { provider });

  const admin = createAdminClient();

  // Log job
  const { data: job } = await admin
    .from('jobs')
    .insert({
      user_id: userData.user.id,
      kind: 'interview_report',
      status: 'running',
      provider,
      model: 'gpt-4o-mini',
      input: { mode, question_count: questions.length },
      started_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  try {
    const client = new OpenAI({ apiKey: requireEnv('OPENAI_API_KEY') });

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: REPORT_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });

    const content = completion.choices[0]?.message?.content ?? '';
    
    // Parse the JSON response
    let parsedReport: unknown;
    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedReport = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch {
      console.error('[report] Failed to parse LLM response:', content);
      // Use fallback report
      parsedReport = {};
    }

    // Normalize the report
    const normalizedReport = normalizeMockInterviewReport(parsedReport, mode);

    // Save report to database
    const { data: savedReport, error: saveErr } = await admin
      .from('interview_reports')
      .insert({
        session_id: id,
        user_id: userData.user.id,
        mode: normalizedReport.mode,
        overall_score: normalizedReport.overall_score,
        hiring_signal: normalizedReport.hiring_signal,
        summary: normalizedReport.summary,
        strengths: normalizedReport.strengths,
        weaknesses: normalizedReport.weaknesses,
        next_steps: normalizedReport.next_steps,
        rubric: normalizedReport.rubric,
        generated_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (saveErr) {
      console.error('[report] Failed to save report:', saveErr);
    }

    // Update job status
    if (job?.id) {
      await admin
        .from('jobs')
        .update({
          status: 'succeeded',
          output: normalizedReport as unknown as Record<string, unknown>,
          finished_at: new Date().toISOString(),
        })
        .eq('id', job.id);
    }

    return NextResponse.json({ 
      report: normalizedReport,
      saved: !!savedReport,
      jobId: job?.id ?? null 
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown_error';

    if (job?.id) {
      await admin
        .from('jobs')
        .update({
          status: 'failed',
          error: msg,
          finished_at: new Date().toISOString(),
        })
        .eq('id', job.id);
    }

    return jsonError(500, 'report_generation_failed', { message: msg });
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `interview_report:get:${ip}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  // Verify session belongs to user
  const { data: session } = await supabase
    .from('interview_sessions')
    .select('id')
    .eq('id', id)
    .eq('user_id', userData.user.id)
    .single();

  if (!session) return jsonError(404, 'not_found');

  // Get latest report
  const { data: report, error } = await supabase
    .from('interview_reports')
    .select('*')
    .eq('session_id', id)
    .order('generated_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !report) return jsonError(404, 'report_not_found');

  return NextResponse.json({ report });
}
