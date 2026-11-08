import type { SupabaseClient } from '@supabase/supabase-js';
import type { PackMaterial, PackMemory } from '@/lib/copilot/contextPack';

/**
 * Goals: one saved setup per job the user is going for (company, role,
 * round, résumé, job description, materials, playbook), reused by every
 * live session and practice interview for that job. Read with the user's
 * client: RLS (migration 0031) scopes every row to them.
 */

export { GOAL_ROUNDS, type GoalRound } from '@/lib/goalTypes';

export type SessionSources = {
  goalId: string | null;
  company: string | null;
  role: string | null;
  round: string | null;
  jobDescription: string | null;
  resume: { id: string; filename: string | null; parsed_text: string | null } | null;
  materials: PackMaterial[];
  playbook: string | null;
  memories: PackMemory[];
};

/** How many memories a session carries: the goal's own first, then general ones. */
export const MEMORY_LIMIT = 40;

/** The user's memories for a session; none when they can't be read (memory is never required). */
export async function loadMemories(supabase: SupabaseClient, userId: string, goalId: string | null): Promise<PackMemory[]> {
  let rows: Array<{ id: string; content: string; goal_id: string | null }> = [];
  try {
    const { data } = await supabase
      .from('memories')
      .select('id, content, goal_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200);
    rows = (data ?? []) as typeof rows;
  } catch {
    return [];
  }
  const relevant = rows.filter((row) => row.goal_id === null || row.goal_id === goalId);
  relevant.sort((a, b) => Number(b.goal_id === goalId && goalId !== null) - Number(a.goal_id === goalId && goalId !== null));
  return relevant.slice(0, MEMORY_LIMIT).map(({ id, content }) => ({ id, content }));
}

export async function loadPlaybook(supabase: SupabaseClient, userId: string, playbookId: string | null): Promise<string | null> {
  if (!playbookId) return null;
  const { data } = await supabase
    .from('playbooks')
    .select('instructions')
    .eq('id', playbookId)
    .eq('user_id', userId)
    .maybeSingle<{ instructions: string }>();
  return data?.instructions ?? null;
}

type GoalRow = {
  id: string;
  user_id: string;
  company: string | null;
  role: string | null;
  round: string | null;
  job_description: string | null;
  resume_document_id: string | null;
  playbook_id: string | null;
};

/** Everything a session needs from a goal, or null when it isn't the user's. */
export async function loadGoalSources(supabase: SupabaseClient, userId: string, goalId: string): Promise<SessionSources | null> {
  const { data: goal } = await supabase
    .from('goals')
    .select('id, user_id, company, role, round, job_description, resume_document_id, playbook_id')
    .eq('id', goalId)
    .maybeSingle<GoalRow>();
  if (!goal || goal.user_id !== userId) return null;

  const [resume, links, playbook, memories] = await Promise.all([
    goal.resume_document_id
      ? supabase
          .from('resume_documents')
          .select('id, filename, parsed_text')
          .eq('id', goal.resume_document_id)
          .maybeSingle<{ id: string; filename: string | null; parsed_text: string | null }>()
          .then(({ data }) => data)
      : Promise.resolve(null),
    supabase.from('goal_materials').select('material_id').eq('goal_id', goalId),
    loadPlaybook(supabase, userId, goal.playbook_id),
    loadMemories(supabase, userId, goalId),
  ]);
  const materialIds = ((links.data ?? []) as Array<{ material_id: string }>).map((row) => row.material_id);
  const { data: materials } = materialIds.length
    ? await supabase.from('materials').select('id, title, content').in('id', materialIds)
    : { data: [] as PackMaterial[] };

  return {
    goalId: goal.id,
    company: goal.company,
    role: goal.role,
    round: goal.round,
    jobDescription: goal.job_description,
    resume,
    materials: (materials ?? []) as PackMaterial[],
    playbook,
    memories,
  };
}
