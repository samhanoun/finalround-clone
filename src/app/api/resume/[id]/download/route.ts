import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { jsonError } from '@/lib/api';
import { isOwnResumeObject, RESUME_BUCKET } from '@/lib/resumeStorage';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');
  const userId = userData.user.id;

  // Ownership check via DB row
  const { data: doc, error } = await supabase
    .from('resume_documents')
    .select('id,storage_bucket,storage_path')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error || !doc) return jsonError(404, 'not_found');

  // The row is the user's, but its bucket and path are editable: only an object in their own
  // folder is signed, never another user's file (src/lib/resumeStorage.ts).
  if (!isOwnResumeObject(userId, doc.storage_bucket, doc.storage_path)) {
    console.error('[resume] download refused: the stored file is outside the user\'s folder', { id, userId });
    return jsonError(404, 'not_found');
  }

  // Sign URL server-side. Uses service role.
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return jsonError(500, 'SUPABASE_SERVICE_ROLE_KEY_missing');
  }

  const { data: signed, error: signErr } = await admin.storage
    .from(RESUME_BUCKET)
    .createSignedUrl(doc.storage_path, 60); // 60s

  if (signErr || !signed?.signedUrl) return jsonError(500, 'sign_failed', signErr);

  return NextResponse.json({ url: signed.signedUrl });
}
