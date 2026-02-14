import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs';

const QuerySchema = z.object({
  bucket: z.string().min(1).max(64).default('resumes'),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = rateLimit({ key: `resume_upload:post:${ip}`, limit: 10, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  // Requires SUPABASE_SERVICE_ROLE_KEY because Supabase Storage upload is easiest as admin.
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return jsonError(500, 'SUPABASE_SERVICE_ROLE_KEY_missing');
  }

  const { searchParams } = new URL(req.url);
  const parseQ = QuerySchema.safeParse({ bucket: searchParams.get('bucket') ?? undefined });
  if (!parseQ.success) return jsonError(400, 'invalid_query', parseQ.error.flatten());

  const form = await req.formData().catch(() => null);
  if (!form) return jsonError(400, 'invalid_form');

  const file = form.get('file');
  if (!(file instanceof File)) return jsonError(400, 'file_required');

  const arrayBuffer = await file.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);

  const sha256 = createHash('sha256').update(buf).digest('hex');
  const bucket = parseQ.data.bucket;
  const path = `${userData.user.id}/${Date.now()}-${file.name}`;

  const { error: upErr } = await admin.storage.from(bucket).upload(path, buf, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (upErr) return jsonError(500, 'storage_upload_failed', upErr);

  const { data: doc, error: docErr } = await supabase
    .from('resume_documents')
    .insert({
      user_id: userData.user.id,
      filename: file.name,
      content_type: file.type,
      size_bytes: buf.length,
      storage_bucket: bucket,
      storage_path: path,
    })
    .select('*')
    .single();

  if (docErr) return jsonError(500, 'db_error', docErr);

  return NextResponse.json({ document: doc, sha256 });
}
