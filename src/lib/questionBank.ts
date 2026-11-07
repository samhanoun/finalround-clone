import type { SupabaseClient } from '@supabase/supabase-js';
import type { QuestionType } from '@/lib/practice/practice';

/**
 * Company question banks (supabase/migrations/0031): questions asked for a
 * company. Practice interviews add theirs privately; candidates report ones
 * from real interviews and may share them. Shared questions come back
 * grouped, with how many people reported them and never who.
 */

export const BANK_QUESTION_TYPES = ['behavioral', 'technical', 'situational', 'general'] as const;

export type BankQuestion = {
  id: string;
  company: string;
  role: string | null;
  question_text: string;
  question_type: QuestionType;
  source: 'practice' | 'reported';
  shared: boolean;
  created_at: string;
};

export type SharedQuestion = {
  question_text: string;
  question_type: QuestionType;
  /** How many people reported it. */
  reports: number;
  last_reported_at: string;
};

export const BANK_COLUMNS = 'id, company, role, question_text, question_type, source, shared, created_at';

export function questionKey(text: string): string {
  return text.trim().toLowerCase();
}

/** The company as the bank matches it (the database's company_key). */
export function companyKey(company: string): string {
  return company.trim().toLowerCase();
}

/** Keeps practice questions in the user's private bank for that company; ones already there are skipped. */
export async function saveToBank(
  supabase: SupabaseClient,
  userId: string,
  entry: { company: string; role?: string | null; source: BankQuestion['source'] },
  questions: Array<{ text: string; type: QuestionType }>,
): Promise<void> {
  if (!entry.company.trim() || questions.length === 0) return;
  const { error } = await supabase.from('company_questions').upsert(
    questions.map((question) => ({
      user_id: userId,
      company: entry.company.trim(),
      role: entry.role?.trim() || null,
      question_text: question.text.trim(),
      question_type: question.type,
      source: entry.source,
    })),
    { onConflict: 'user_id,company_key,question_key', ignoreDuplicates: true },
  );
  if (error) throw new Error(`save_to_bank: ${error.message}`);
}

/** The user's own questions for a company and the shared ones they don't already have. */
export async function loadBank(
  supabase: SupabaseClient,
  company: string,
): Promise<{ mine: BankQuestion[]; shared: SharedQuestion[] }> {
  const [own, shared] = await Promise.all([
    supabase
      .from('company_questions')
      .select(BANK_COLUMNS)
      .eq('company_key', companyKey(company))
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.rpc('company_question_bank', { p_company: company, p_limit: 100 }),
  ]);
  if (own.error) throw new Error(`load_bank: ${own.error.message}`);
  if (shared.error) throw new Error(`load_bank_shared: ${shared.error.message}`);
  const mine = (own.data ?? []) as BankQuestion[];
  const known = new Set(mine.map((question) => questionKey(question.question_text)));
  const others = ((shared.data ?? []) as SharedQuestion[])
    .map((question) => ({ ...question, reports: Number(question.reports) }))
    .filter((question) => !known.has(questionKey(question.question_text)));
  return { mine, shared: others };
}

/**
 * Up to `count` bank questions for a practice interview: questions reported
 * from real interviews (yours, then other candidates', most reported first),
 * then ones from your earlier practice. Shuffled within each group.
 */
export function pickBankQuestions(
  bank: { mine: BankQuestion[]; shared: SharedQuestion[] },
  count: number,
  random: () => number = Math.random,
): Array<{ text: string; type: QuestionType }> {
  const shuffle = <T>(items: T[]) =>
    items
      .map((item) => ({ item, order: random() }))
      .sort((a, b) => a.order - b.order)
      .map(({ item }) => item);
  const reported = shuffle(bank.mine.filter((q) => q.source === 'reported')).map((q) => ({ text: q.question_text, type: q.question_type }));
  const shared = bank.shared.map((q) => ({ text: q.question_text, type: q.question_type }));
  const practiced = shuffle(bank.mine.filter((q) => q.source === 'practice')).map((q) => ({ text: q.question_text, type: q.question_type }));
  const seen = new Set<string>();
  const picked: Array<{ text: string; type: QuestionType }> = [];
  for (const question of [...reported, ...shared, ...practiced]) {
    const key = questionKey(question.text);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(question);
    if (picked.length >= count) break;
  }
  return picked;
}
