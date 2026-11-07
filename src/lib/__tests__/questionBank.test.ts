import { loadBank, pickBankQuestions, type BankQuestion, type SharedQuestion } from '@/lib/questionBank';
import type { SupabaseClient } from '@supabase/supabase-js';

function own(text: string, source: BankQuestion['source']): BankQuestion {
  return {
    id: text,
    company: 'Acme',
    role: null,
    question_text: text,
    question_type: 'general',
    source,
    shared: false,
    created_at: '2026-10-01T00:00:00Z',
  };
}

function shared(text: string, reports: number): SharedQuestion {
  return { question_text: text, question_type: 'behavioral', reports, last_reported_at: '2026-10-02T00:00:00Z' };
}

describe('pickBankQuestions', () => {
  it('takes questions from real interviews first, then shared ones, then earlier practice', () => {
    const picked = pickBankQuestions(
      {
        mine: [own('From practice', 'practice'), own('You were asked', 'reported')],
        shared: [shared('Shared often', 5), shared('Shared once', 1)],
      },
      3,
      () => 0.5,
    );
    expect(picked.map((q) => q.text)).toEqual(['You were asked', 'Shared often', 'Shared once']);
  });

  it('never repeats a question, whatever its case or spacing', () => {
    const picked = pickBankQuestions({ mine: [own('Why Acme?', 'reported')], shared: [shared('  why acme? ', 2)] }, 5);
    expect(picked).toHaveLength(1);
  });
});

describe('loadBank', () => {
  it("leaves out shared questions the user already has, and never asks who shared them", async () => {
    const rpc = jest.fn(async () => ({ data: [shared('Why Acme?', 2), shared('Tell me about a failure.', 1)], error: null }));
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'limit']) builder[method] = () => builder;
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [own('why acme?', 'practice')], error: null }).then(resolve);
    const supabase = { from: () => builder, rpc } as unknown as SupabaseClient;

    const bank = await loadBank(supabase, 'Acme');

    expect(rpc).toHaveBeenCalledWith('company_question_bank', { p_company: 'Acme', p_limit: 100 });
    expect(bank.mine).toHaveLength(1);
    expect(bank.shared.map((q) => q.question_text)).toEqual(['Tell me about a failure.']);
  });
});
