'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/browser';
import type { Goal, Material, Memory, Playbook } from '@/lib/goalTypes';
import { GoalsTab } from './GoalsTab';
import { MaterialsTab } from './MaterialsTab';
import { PlaybooksTab } from './PlaybooksTab';
import { MemoryTab } from './MemoryTab';
import styles from './Goals.module.css';

const TABS = ['goals', 'materials', 'playbooks', 'memory'] as const;
type Tab = (typeof TABS)[number];

export type ResumeOption = { id: string; filename: string | null };
export type JobOption = { id: string; company: string; title: string; notes: string | null; job_url: string | null };

export type WorkspaceData = {
  goals: Goal[];
  materials: Material[];
  playbooks: Playbook[];
  memories: Memory[];
  resumes: ResumeOption[];
  jobs: JobOption[];
  memoryEnabled: boolean;
};

/** Everything the workspace shows; null when signed out, 'failed' when a query fails. */
async function fetchWorkspace(): Promise<WorkspaceData | 'failed' | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const [goals, links, materials, playbooks, memories, resumes, jobs, profile] = await Promise.all([
    supabase.from('goals').select('*').order('updated_at', { ascending: false }),
    supabase.from('goal_materials').select('goal_id, material_id'),
    supabase.from('materials').select('id, title, kind, content, source_filename, created_at').order('created_at', { ascending: false }),
    supabase.from('playbooks').select('id, name, instructions, updated_at').order('updated_at', { ascending: false }),
    supabase.from('memories').select('id, goal_id, content, source, created_at').order('created_at', { ascending: false }).limit(300),
    supabase.from('resume_documents').select('id, filename').not('parsed_text', 'is', null).order('created_at', { ascending: false }).limit(30),
    supabase.from('job_applications').select('id, company, title, notes, job_url').eq('status', 'active').order('updated_at', { ascending: false }).limit(100),
    supabase.from('profiles').select('memory_enabled').eq('id', user.id).maybeSingle(),
  ]);
  if (goals.error || materials.error || playbooks.error || memories.error) {
    return 'failed';
  }
  const byGoal = new Map<string, string[]>();
  for (const link of (links.data ?? []) as Array<{ goal_id: string; material_id: string }>) {
    byGoal.set(link.goal_id, [...(byGoal.get(link.goal_id) ?? []), link.material_id]);
  }
  return {
    goals: ((goals.data ?? []) as Goal[]).map((goal) => ({ ...goal, material_ids: byGoal.get(goal.id) ?? [] })),
    materials: (materials.data ?? []) as Material[],
    playbooks: (playbooks.data ?? []) as Playbook[],
    memories: (memories.data ?? []) as Memory[],
    resumes: (resumes.data ?? []) as ResumeOption[],
    jobs: (jobs.data ?? []) as JobOption[],
    memoryEnabled: (profile.data as { memory_enabled?: boolean } | null)?.memory_enabled !== false,
  };
}

/** Goals, materials, playbooks and memory: what the live copilot and practice draw on. */
export function GoalsWorkspace() {
  const t = useTranslations('Goals');
  const sp = useSearchParams();
  const initialTab = TABS.includes(sp.get('tab') as Tab) ? (sp.get('tab') as Tab) : 'goals';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [failed, setFailed] = useState(false);

  const apply = useCallback((result: WorkspaceData | 'failed' | null) => {
    if (result === 'failed') setFailed(true);
    else if (result) {
      setFailed(false);
      setData(result);
    }
  }, []);
  const load = useCallback(async () => apply(await fetchWorkspace()), [apply]);

  useEffect(() => {
    let cancelled = false;
    void fetchWorkspace().then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  return (
    <div className={styles.workspace}>
      <nav className={styles.tabs} aria-label={t('sections')}>
        <div className={styles.tabList}>
          {TABS.map((id) => (
            <button key={id} type="button" className={styles.tab} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
              {t(`tabs.${id}`)}
              {data ? (
                <>
                  {' '}
                  <span className={styles.count}>{countFor(id, data)}</span>
                </>
              ) : null}
            </button>
          ))}
        </div>
      </nav>

      {failed ? (
        <p className="emptyState" role="alert">
          {t('loadFailed')}
        </p>
      ) : !data ? (
        <p className={styles.loading}>{t('loading')}</p>
      ) : tab === 'goals' ? (
        <GoalsTab data={data} reload={load} fromJob={sp.get('fromJob')} />
      ) : tab === 'materials' ? (
        <MaterialsTab data={data} reload={load} />
      ) : tab === 'playbooks' ? (
        <PlaybooksTab data={data} reload={load} />
      ) : (
        <MemoryTab data={data} reload={load} />
      )}
    </div>
  );
}

function countFor(tab: Tab, data: WorkspaceData) {
  if (tab === 'goals') return data.goals.filter((goal) => !goal.archived).length;
  if (tab === 'materials') return data.materials.length;
  if (tab === 'playbooks') return data.playbooks.length;
  return data.memories.length;
}
