import { createClient } from '@/lib/supabase/server';

export interface ResumeVersion {
  id: string;
  user_id: string;
  filename: string | null;
  version: number;
  parent_version_id: string | null;
  parsed_text: string | null;
  ats_score: number | null;
  keywords: string[];
  created_at: string;
}

/**
 * Get all versions of a user's resume
 */
export async function getResumeVersions(userId: string): Promise<ResumeVersion[]> {
  const supabase = await createClient();
  
  const { data, error } = await supabase
    .from('resume_documents')
    .select('id, user_id, filename, version, parent_version_id, parsed_text, ats_score, keywords, created_at')
    .eq('user_id', userId)
    .order('version', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch resume versions: ${error.message}`);
  }

  return data || [];
}

/**
 * Create a new version of a resume
 */
export async function createResumeVersion(
  userId: string,
  parentVersionId: string | null,
  filename: string,
  parsedText?: string,
  keywords?: string[]
): Promise<ResumeVersion> {
  const supabase = await createClient();

  // Get the latest version number
  const { data: latest } = await supabase
    .from('resume_documents')
    .select('version')
    .eq('user_id', userId)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  const newVersion = latest ? latest.version + 1 : 1;

  const { data, error } = await supabase
    .from('resume_documents')
    .insert({
      user_id: userId,
      filename,
      version: newVersion,
      parent_version_id: parentVersionId,
      parsed_text: parsedText || null,
      keywords: keywords || [],
      parse_status: 'completed',
    })
    .select('id, user_id, filename, version, parent_version_id, parsed_text, ats_score, keywords, created_at')
    .single();

  if (error) {
    throw new Error(`Failed to create resume version: ${error.message}`);
  }

  return data;
}

/**
 * Get a specific resume version by ID
 */
export async function getResumeVersion(
  versionId: string,
  userId: string
): Promise<ResumeVersion | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('resume_documents')
    .select('id, user_id, filename, version, parent_version_id, parsed_text, ats_score, keywords, created_at')
    .eq('id', versionId)
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to fetch resume version: ${error.message}`);
  }

  return data;
}

/**
 * Update resume version with new content
 */
export async function updateResumeVersion(
  versionId: string,
  userId: string,
  updates: {
    parsed_text?: string;
    ats_score?: number;
    keywords?: string[];
  }
): Promise<ResumeVersion> {
  const supabase = await createClient();

  const updateData: Record<string, unknown> = {};
  if (updates.parsed_text !== undefined) updateData.parsed_text = updates.parsed_text;
  if (updates.ats_score !== undefined) updateData.ats_score = updates.ats_score;
  if (updates.keywords !== undefined) updateData.keywords = updates.keywords;

  const { data, error } = await supabase
    .from('resume_documents')
    .update(updateData)
    .eq('id', versionId)
    .eq('user_id', userId)
    .select('id, user_id, filename, version, parent_version_id, parsed_text, ats_score, keywords, created_at')
    .single();

  if (error) {
    throw new Error(`Failed to update resume version: ${error.message}`);
  }

  return data;
}

/**
 * Compare two resume versions
 */
export async function compareVersions(
  versionId1: string,
  versionId2: string,
  userId: string
): Promise<{
  version1: ResumeVersion;
  version2: ResumeVersion;
  differences: {
    scoreDiff: number;
    keywordChanges: { added: string[]; removed: string[] };
  };
}> {
  const [v1, v2] = await Promise.all([
    getResumeVersion(versionId1, userId),
    getResumeVersion(versionId2, userId),
  ]);

  if (!v1 || !v2) {
    throw new Error('One or both versions not found');
  }

  const keywords1 = v1.keywords || [];
  const keywords2 = v2.keywords || [];

  return {
    version1: v1,
    version2: v2,
    differences: {
      scoreDiff: (v2.ats_score || 0) - (v1.ats_score || 0),
      keywordChanges: {
        added: keywords2.filter((k) => !keywords1.includes(k)),
        removed: keywords1.filter((k) => !keywords2.includes(k)),
      },
    },
  };
}

/**
 * Delete a resume version (only if it has no children)
 */
export async function deleteResumeVersion(
  versionId: string,
  userId: string
): Promise<void> {
  const supabase = await createClient();

  // Check if this version has children
  const { data: children } = await supabase
    .from('resume_documents')
    .select('id')
    .eq('parent_version_id', versionId)
    .limit(1);

  if (children && children.length > 0) {
    throw new Error('Cannot delete version with child versions');
  }

  const { error } = await supabase
    .from('resume_documents')
    .delete()
    .eq('id', versionId)
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to delete resume version: ${error.message}`);
  }
}
