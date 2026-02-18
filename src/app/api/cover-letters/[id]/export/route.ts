import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/api';
import { rateLimit } from '@/lib/rateLimit';
import { getCoverLetter } from '@/lib/coverLetter';

// Validation schema for export
const ExportSchema = z.object({
  format: z.enum(['txt', 'md', 'json']).default('txt'),
  includeMetadata: z.boolean().default(false),
});

/**
 * GET /api/cover-letters/[id]/export
 * Export a cover letter in the requested format
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit({ key: `cover_letters:export:${ip}`, limit: 30, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return jsonError(401, 'unauthorized');

  const { id } = await params;

  // Parse query params
  const searchParams = req.nextUrl.searchParams;
  const format = searchParams.get('format') as 'txt' | 'md' | 'json' | null;
  const includeMetadata = searchParams.get('includeMetadata') === 'true';

  const parse = ExportSchema.safeParse({ format, includeMetadata });
  if (!parse.success) {
    return jsonError(400, 'invalid_params', parse.error.flatten());
  }

  try {
    const coverLetter = await getCoverLetter(userData.user.id, id);
    const exportFormat = parse.data.format;

    let content: string;
    let contentType: string;
    let filename: string;

    const safeTitle = (coverLetter.title || 'cover-letter')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    switch (exportFormat) {
      case 'md':
        content = formatAsMarkdown(coverLetter, parse.data.includeMetadata);
        contentType = 'text/markdown';
        filename = `${safeTitle}.md`;
        break;
      case 'json':
        content = formatAsJson(coverLetter, parse.data.includeMetadata);
        contentType = 'application/json';
        filename = `${safeTitle}.json`;
        break;
      case 'txt':
      default:
        content = coverLetter.content || '';
        contentType = 'text/plain';
        filename = `${safeTitle}.txt`;
        break;
    }

    // Update status to exported if it was saved
    if (coverLetter.status !== 'exported' && coverLetter.id) {
      const admin = await createClient();
      await admin
        .from('cover_letters')
        .update({ status: 'exported' })
        .eq('id', coverLetter.id);
    }

    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Failed to export cover letter:', error);
    return jsonError(500, 'export_failed', { message: 'Failed to export cover letter' });
  }
}

/**
 * Format cover letter as Markdown
 */
function formatAsMarkdown(coverLetter: Record<string, unknown>, includeMetadata: boolean): string {
  let md = '';
  
  if (includeMetadata) {
    md += '---\n';
    md += `title: "${coverLetter.title}"\n`;
    md += `tone: ${coverLetter.tone}\n`;
    md += `company: ${(coverLetter.metadata as Record<string, unknown>)?.companyName || 'N/A'}\n`;
    md += `position: ${(coverLetter.metadata as Record<string, unknown>)?.jobTitle || 'N/A'}\n`;
    if ((coverLetter.metadata as Record<string, unknown>)?.matchedKeywords) {
      md += `matchedKeywords: ${JSON.stringify((coverLetter.metadata as Record<string, unknown>).matchedKeywords)}\n`;
    }
    if ((coverLetter.metadata as Record<string, unknown>)?.alignmentScore) {
      md += `alignmentScore: ${(coverLetter.metadata as Record<string, unknown>).alignmentScore}\n`;
    }
    md += `created: ${coverLetter.created_at}\n`;
    md += '---\n\n';
  }
  
  md += '# Cover Letter\n\n';
  md += coverLetter.content || '';
  
  return md;
}

/**
 * Format cover letter as JSON
 */
function formatAsJson(coverLetter: Record<string, unknown>, includeMetadata: boolean): string {
  const output: Record<string, unknown> = {
    content: coverLetter.content,
  };
  
  if (includeMetadata) {
    output.metadata = {
      title: coverLetter.title,
      tone: coverLetter.tone,
      status: coverLetter.status,
      jobTitle: (coverLetter.metadata as Record<string, unknown>)?.jobTitle,
      companyName: (coverLetter.metadata as Record<string, unknown>)?.companyName,
      matchedKeywords: (coverLetter.metadata as Record<string, unknown>)?.matchedKeywords,
      alignmentScore: (coverLetter.metadata as Record<string, unknown>)?.alignmentScore,
      createdAt: coverLetter.created_at,
      updatedAt: coverLetter.updated_at,
    };
  }
  
  return JSON.stringify(output, null, 2);
}
