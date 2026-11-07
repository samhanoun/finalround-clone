/** Goals, materials, playbooks and memories as the browser sees them (safe to import anywhere). */

export const GOAL_ROUNDS = ['screen', 'behavioral', 'technical', 'system_design', 'final', 'other'] as const;
export type GoalRound = (typeof GOAL_ROUNDS)[number];

export const MATERIAL_KINDS = ['notes', 'project', 'company', 'portfolio', 'other'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export type Goal = {
  id: string;
  name: string;
  company: string | null;
  role: string | null;
  round: GoalRound;
  resume_document_id: string | null;
  job_description: string | null;
  job_application_id: string | null;
  playbook_id: string | null;
  notes: string | null;
  archived: boolean;
  updated_at: string;
  material_ids: string[];
};

export type Material = {
  id: string;
  title: string;
  kind: MaterialKind;
  content: string;
  source_filename: string | null;
  created_at: string;
};

export type Playbook = { id: string; name: string; instructions: string; updated_at: string };

export type Memory = {
  id: string;
  goal_id: string | null;
  content: string;
  source: 'manual' | 'session';
  created_at: string;
};
