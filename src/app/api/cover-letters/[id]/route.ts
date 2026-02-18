import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { getCoverLetter, updateCoverLetter, deleteCoverLetter } from '@/lib/coverLetter';

// Validation schema for updating a cover letter
const UpdateSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  tone: z.enum(['professional', 'friendly', 'formal', 'casual', 'confident']).optional(),
  status: z.enum(['draft', 'generated', 'saved', 'exported']).optional(),
});

/**
 * GET /api/cover-letters/[id]
 * Get a specific cover letter
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `cover_letters:get:${ip}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  const { id } = await params;

  try {
    const coverLetter = await getCoverLetter(userData.user.id, id);
    return NextResponse.json({ cover_letter: coverLetter });
  } catch (error) {
    console.error('Failed to fetch cover letter:', error);
    return jsonError(404, 'not_found', { message: 'Cover letter not found' });
  }
}

/**
 * PATCH /api/cover-letters/[id]
 * Update a cover letter
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `cover_letters:patch:${ip}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parse = UpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) {
    return jsonError(400, 'invalid_body', parse.error.flatten());
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  const { id } = await params;

  try {
    const updated = await updateCoverLetter(userData.user.id, id, parse.data);
    return NextResponse.json({ cover_letter: updated });
  } catch (error) {
    console.error('Failed to update cover letter:', error);
    return jsonError(500, 'update_failed', { message: 'Failed to update cover letter' });
  }
}

/**
 * DELETE /api/cover-letters/[id]
 * Delete a cover letter
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `cover_letters:delete:${ip}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  const { id } = await params;

  try {
    await deleteCoverLetter(userData.user.id, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete cover letter:', error);
    return jsonError(500, 'delete_failed', { message: 'Failed to delete cover letter' });
  }
}
