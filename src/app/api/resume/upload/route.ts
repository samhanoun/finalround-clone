import { NextResponse, type NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { extractDocumentText, extractResumeData } from '@/lib/resumeParser';
import { RESUME_BUCKET, resumeObjectPath } from '@/lib/resumeStorage';

export const runtime = 'nodejs';

/** Résumés are PDF or Word files of up to 5 MB (Resume.errors.file_too_large says so). */
const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const RESUME_FILE = /\.(pdf|docx|doc)$/i;

/**
 * POST /api/resume/upload (multipart: file; ?autoParse=false to skip reading
 * it) - stores the file in the résumés bucket under the user's own folder
 * (always: the bucket isn't the caller's choice) and saves its text.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `resume_upload:post:${ip}`, limit: 10, windowMs: 60_000 });
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

  const autoParse = new URL(req.url).searchParams.get('autoParse') !== 'false';

  const form = await req.formData().catch(() => null);
  if (!form) return jsonError(400, 'invalid_form');

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return jsonError(400, 'file_required');
  // Checked before anything is stored: the file picker's filter is only a hint.
  if (!RESUME_FILE.test(file.name)) return jsonError(415, 'unsupported_type');
  if (file.size > MAX_RESUME_BYTES) return jsonError(413, 'file_too_large');

  const arrayBuffer = await file.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);

  const sha256 = createHash('sha256').update(buf).digest('hex');
  // The user's own folder, with a safe file name; the original name is kept in the row for display.
  const path = resumeObjectPath(userData.user.id, file.name);

  const { error: upErr } = await admin.storage.from(RESUME_BUCKET).upload(path, buf, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (upErr) return jsonError(500, 'storage_upload_failed', upErr);

  // Read the text from the bytes we already have, rather than downloading the file again.
  let parsedText = null;
  let parsedData = {};
  let parseStatus = 'pending';
  let parseError = null;

  if (autoParse) {
    try {
      const parseResult = await extractDocumentText(arrayBuffer, file.name, file.type || 'application/octet-stream');
      parsedText = parseResult.text;
      parsedData = extractResumeData(parseResult.text);
      parseStatus = 'completed';
    } catch (e) {
      parseError = e instanceof Error ? e.message : 'Parse failed';
      parseStatus = 'failed';
    }
  }

  const { data: doc, error: docErr } = await supabase
    .from('resume_documents')
    .insert({
      user_id: userData.user.id,
      filename: file.name,
      content_type: file.type,
      size_bytes: buf.length,
      storage_bucket: RESUME_BUCKET,
      storage_path: path,
      parsed_text: parsedText,
      parsed_data: parsedData,
      parse_status: parseStatus,
      parse_error: parseError,
    })
    .select('*')
    .single();

  if (docErr) return jsonError(500, 'db_error', docErr);

  return NextResponse.json({
    document: doc,
    sha256,
    parsed: autoParse ? {
      status: parseStatus,
      error: parseError,
      wordCount: parsedText ? parsedText.split(/\s+/).length : 0,
    } : null,
  });
}
