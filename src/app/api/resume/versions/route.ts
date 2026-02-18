import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import {
  getResumeVersions,
  createResumeVersion,
  getResumeVersion,
  compareVersions,
} from '@/lib/resumeVersions';

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `resume_versions:get:${ip}`, limit: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  const { searchParams } = new URL(req.url);
  const versionId = searchParams.get('versionId');
  const compareWith = searchParams.get('compareWith');

  // If comparing two versions
  if (versionId && compareWith) {
    try {
      const comparison = await compareVersions(versionId, compareWith, userData.user.id);
      return NextResponse.json(comparison);
    } catch (e) {
      return jsonError(400, e instanceof Error ? e.message : 'Comparison failed');
    }
  }

  // If getting a specific version
  if (versionId) {
    const version = await getResumeVersion(versionId, userData.user.id);
    if (!version) {
      return jsonError(404, 'version_not_found');
    }
    return NextResponse.json({ version });
  }

  // Get all versions
  const versions = await getResumeVersions(userData.user.id);
  return NextResponse.json({ versions });
}

const CreateVersionSchema = z.object({
  filename: z.string().min(1),
  parentVersionId: z.string().uuid().optional(),
  parsedText: z.string().optional(),
  keywords: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `resume_versions:post:${ip}`, limit: 20, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parse = CreateVersionSchema.safeParse(await req.json().catch(() => null));
  if (!parse.success) return jsonError(400, 'invalid_body', parse.error.flatten());

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  try {
    const version = await createResumeVersion(
      userData.user.id,
      parse.data.parentVersionId ?? null,
      parse.data.filename,
      parse.data.parsedText,
      parse.data.keywords
    );
    return NextResponse.json({ version }, { status: 201 });
  } catch (e) {
    return jsonError(500, e instanceof Error ? e.message : 'Failed to create version');
  }
}
