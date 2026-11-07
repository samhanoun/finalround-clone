import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rateLimit';
import { extractDocumentText } from '@/lib/resumeParser';
import { MATERIAL_KINDS, type MaterialKind } from '@/lib/goalTypes';

/**
 * POST /api/materials/upload (multipart: file, kind, title?) - a PDF, Word,
 * text or Markdown file becomes a material: only its text is kept (for
 * retrieval in live sessions), not the file.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = /\.(pdf|docx|txt|md|markdown)$/i;
const MAX_CHARS = 60_000;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const rl = await rateLimit({ key: `material_upload:${user.id}`, limit: 20, windowMs: 60 * 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'missing_file' }, { status: 400 });
  if (!ALLOWED.test(file.name)) return NextResponse.json({ error: 'unsupported_type' }, { status: 415 });
  if (file.size === 0 || file.size > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 });

  const kindValue = String(form?.get('kind') ?? 'notes');
  const kind: MaterialKind = (MATERIAL_KINDS as readonly string[]).includes(kindValue) ? (kindValue as MaterialKind) : 'notes';
  const title = (String(form?.get('title') ?? '').trim() || file.name.replace(/\.[^.]+$/, '')).slice(0, 200);

  let text: string;
  try {
    ({ text } = await extractDocumentText(await file.arrayBuffer(), file.name, file.type));
  } catch {
    return NextResponse.json({ error: 'unreadable' }, { status: 422 });
  }
  text = text.trim().slice(0, MAX_CHARS);
  if (!text) return NextResponse.json({ error: 'empty' }, { status: 422 });

  const { data, error } = await supabase
    .from('materials')
    .insert({ user_id: user.id, title, kind, content: text, source_filename: file.name.slice(0, 200) })
    .select('id, title, kind, content, source_filename, created_at')
    .single();
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ material: data }, { status: 201 });
}
