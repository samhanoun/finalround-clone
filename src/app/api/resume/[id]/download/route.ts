import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { jsonError } from '@/lib/api';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  // Ownership check via DB row
  const { data: doc, error } = await supabase
    .from('resume_documents')
    .select('id,storage_bucket,storage_path')
    .eq('id', id)
    .eq('user_id', userData.user.id)
    .single();

  if (error || !doc) return jsonError(404, 'not_found');

  // Sign URL server-side. Uses service role.
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return jsonError(500, 'SUPABASE_SERVICE_ROLE_KEY_missing');
  }

  const { data: signed, error: signErr } = await admin.storage
    .from(doc.storage_bucket)
    .createSignedUrl(doc.storage_path, 60); // 60s

  if (signErr || !signed?.signedUrl) return jsonError(500, 'sign_failed', signErr);

  return NextResponse.json({ url: signed.signedUrl });
}
