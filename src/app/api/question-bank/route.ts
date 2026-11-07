import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { BANK_COLUMNS, BANK_QUESTION_TYPES, loadBank, type BankQuestion } from '@/lib/questionBank';

const ReportSchema = z.object({
  company: z.string().trim().min(1).max(120),
  role: z.string().trim().max(120).optional(),
  question: z.string().trim().min(8).max(500),
  type: z.enum(BANK_QUESTION_TYPES).default('general'),
  shared: z.boolean().default(false),
});

// GET /api/question-bank?company=Acme - that company's bank (yours and shared)
// GET /api/question-bank?q=ac - companies with a bank: yours and shared ones
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const company = request.nextUrl.searchParams.get('company')?.trim().slice(0, 120);
  if (company) {
    try {
      return NextResponse.json({ company, ...(await loadBank(supabase, company)) });
    } catch (error) {
      console.error('[question-bank] load failed', error instanceof Error ? error.message : error);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }
  }

  const query = request.nextUrl.searchParams.get('q')?.trim().slice(0, 120) || null;
  const [own, shared] = await Promise.all([
    supabase.from('company_questions').select('company, company_key').eq('user_id', user.id).limit(1000),
    supabase.rpc('company_question_companies', { p_query: query, p_limit: 20 }),
  ]);
  if (own.error || shared.error) return NextResponse.json({ error: 'db_error' }, { status: 500 });

  const companies = new Map<string, { company: string; mine: number; shared: number }>();
  for (const row of (own.data ?? []) as Array<{ company: string; company_key: string }>) {
    if (query && !row.company_key.includes(query.toLowerCase())) continue;
    const entry = companies.get(row.company_key) ?? { company: row.company, mine: 0, shared: 0 };
    entry.mine += 1;
    companies.set(row.company_key, entry);
  }
  for (const row of (shared.data ?? []) as Array<{ company: string; questions: number }>) {
    const key = row.company.trim().toLowerCase();
    const entry = companies.get(key) ?? { company: row.company, mine: 0, shared: 0 };
    entry.shared = Number(row.questions);
    companies.set(key, entry);
  }
  const list = [...companies.values()].sort((a, b) => b.mine + b.shared - (a.mine + a.shared)).slice(0, 30);
  return NextResponse.json({ companies: list });
}

// POST /api/question-bank {company, role?, question, type, shared} - a question you were asked
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rl = await rateLimit({ key: `question_bank:${user.id}`, limit: 30, windowMs: 60 * 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parse = ReportSchema.safeParse(await request.json().catch(() => null));
  if (!parse.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { company, role, question, type, shared } = parse.data;

  const { data, error } = await supabase
    .from('company_questions')
    .insert({
      user_id: user.id,
      company,
      role: role || null,
      question_text: question,
      question_type: type,
      source: 'reported',
      shared,
    })
    .select(BANK_COLUMNS)
    .maybeSingle<BankQuestion>();
  // The unique key: this question is already in your bank for this company.
  if (error?.code === '23505') return NextResponse.json({ error: 'duplicate' }, { status: 409 });
  if (error || !data) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ question: data }, { status: 201 });
}
