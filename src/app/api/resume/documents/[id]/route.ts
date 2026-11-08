import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { isOwnResumeObject, RESUME_BUCKET } from '@/lib/resumeStorage';

export const runtime = 'nodejs';

/**
 * DELETE /api/resume/documents/[id] - the user's own uploaded résumé: the file
 * in storage and its row. Tailored versions, goals and sessions that used it
 * keep their own copies (their links to it are set to null by the database).
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');
  const userId = userData.user.id;

  const rl = await rateLimit({ key: `resume_document:delete:${userId}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return jsonError(404, 'not_found');

  const { data: doc } = await supabase
    .from('resume_documents')
    .select('id, storage_bucket, storage_path')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle<{ id: string; storage_bucket: string | null; storage_path: string | null }>();
  if (!doc) return jsonError(404, 'not_found');

  // The file goes first. If storage can't remove it, the document is still deleted (the user asked
  // for it to go), and the leftover file is logged for cleanup. The stored bucket and path are
  // editable, so only an object in the user's own folder is ever removed (src/lib/resumeStorage.ts).
  if (doc.storage_path && !isOwnResumeObject(userId, doc.storage_bucket, doc.storage_path)) {
    console.error("[resume] file not removed: it is outside the user's folder", { id, userId });
  } else if (doc.storage_path) {
    try {
      const { error } = await createAdminClient().storage.from(RESUME_BUCKET).remove([doc.storage_path]);
      if (error) console.error('[resume] file not removed from storage', { id, error: error.message });
    } catch (error) {
      console.error('[resume] file not removed from storage', { id, error: error instanceof Error ? error.message : error });
    }
  }

  const { error } = await supabase.from('resume_documents').delete().eq('id', id).eq('user_id', userId);
  if (error) return jsonError(500, 'db_error', error);
  return NextResponse.json({ ok: true });
}
