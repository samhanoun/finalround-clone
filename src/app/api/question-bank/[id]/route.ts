import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BANK_COLUMNS, type BankQuestion } from '@/lib/questionBank';

const PatchSchema = z.object({ shared: z.boolean() });

async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// PATCH /api/question-bank/:id {shared} - share one of your questions, or stop sharing it
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { supabase, user } = await signedIn();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parse = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parse.success || !z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('company_questions')
    .update({ shared: parse.data.shared })
    .eq('id', id)
    .eq('user_id', user.id)
    .select(BANK_COLUMNS)
    .maybeSingle<BankQuestion>();
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ question: data });
}

// DELETE /api/question-bank/:id - remove one of your questions (and its shared copy)
export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { supabase, user } = await signedIn();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const { data, error } = await supabase
    .from('company_questions')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle<{ id: string }>();
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
