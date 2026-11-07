'use client';

import { useCallback, useId, useState } from 'react';
import { Link } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/browser';
import { NewPracticeButton } from '@/components/NewPracticeButton';
import { BookIcon, FileTextIcon, LayersIcon, ResumeIcon } from '@/components/icons';
import { GOAL_ROUNDS, type Goal, type GoalRound } from '@/lib/goalTypes';
import type { WorkspaceData } from './GoalsWorkspace';
import { Sheet } from './Sheet';
import styles from './Goals.module.css';

type Draft = {
  id: string | null;
  name: string;
  company: string;
  role: string;
  round: GoalRound;
  resume_document_id: string;
  job_description: string;
  job_application_id: string;
  playbook_id: string;
  notes: string;
  material_ids: string[];
};

const EMPTY: Draft = {
  id: null,
  name: '',
  company: '',
  role: '',
  round: 'other',
  resume_document_id: '',
  job_description: '',
  job_application_id: '',
  playbook_id: '',
  notes: '',
  material_ids: [],
};

function draftFrom(goal: Goal): Draft {
  return {
    id: goal.id,
    name: goal.name,
    company: goal.company ?? '',
    role: goal.role ?? '',
    round: goal.round,
    resume_document_id: goal.resume_document_id ?? '',
    job_description: goal.job_description ?? '',
    job_application_id: goal.job_application_id ?? '',
    playbook_id: goal.playbook_id ?? '',
    notes: goal.notes ?? '',
    material_ids: goal.material_ids,
  };
}

/** "Make a goal" from a Jobs board card (?fromJob=): its existing goal, or a new one filled in from the job. */
function draftForJob(fromJob: string | null, data: WorkspaceData, nameFor: (title: string, company: string) => string): Draft | null {
  if (!fromJob) return null;
  const job = data.jobs.find((item) => item.id === fromJob);
  if (!job) return null;
  const existing = data.goals.find((goal) => goal.job_application_id === job.id);
  return existing
    ? draftFrom(existing)
    : { ...EMPTY, name: nameFor(job.title, job.company), company: job.company, role: job.title, job_application_id: job.id, notes: job.notes ?? '' };
}

export function GoalsTab({ data, reload, fromJob }: { data: WorkspaceData; reload: () => Promise<void>; fromJob: string | null }) {
  const t = useTranslations('Goals');
  const tJobs = useTranslations('Jobs');
  // The workspace mounts this tab once its data has loaded, so a ?fromJob= link opens straight into the editor.
  const [draft, setDraft] = useState<Draft | null>(() =>
    draftForJob(fromJob, data, (title, company) => tJobs('jobAt', { title, company })),
  );
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const closeEditor = useCallback(() => setDraft(null), []);

  const goals = data.goals.filter((goal) => Boolean(goal.archived) === showArchived);
  const hasAny = data.goals.length > 0;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return setBusy(false);
    const row = {
      user_id: user.id,
      name: draft.name.trim() || [draft.role.trim(), draft.company.trim()].filter(Boolean).join(' · ') || t('untitled'),
      company: draft.company.trim() || null,
      role: draft.role.trim() || null,
      round: draft.round,
      resume_document_id: draft.resume_document_id || null,
      job_description: draft.job_description.trim() || null,
      job_application_id: draft.job_application_id || null,
      playbook_id: draft.playbook_id || null,
      notes: draft.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const saved = draft.id
      ? await supabase.from('goals').update(row).eq('id', draft.id).select('id').single()
      : await supabase.from('goals').insert(row).select('id').single();
    if (saved.error || !saved.data) {
      setBusy(false);
      setMessage({ kind: 'error', text: t('saveFailed') });
      return;
    }
    // Materials: the links follow the checkboxes.
    const goalId = saved.data.id as string;
    const before = data.goals.find((goal) => goal.id === goalId)?.material_ids ?? [];
    const removed = before.filter((id) => !draft.material_ids.includes(id));
    const added = draft.material_ids.filter((id) => !before.includes(id));
    if (removed.length) await supabase.from('goal_materials').delete().eq('goal_id', goalId).in('material_id', removed);
    if (added.length) {
      await supabase.from('goal_materials').insert(added.map((material_id) => ({ goal_id: goalId, material_id, user_id: user.id })));
    }
    await reload();
    setBusy(false);
    setDraft(null);
    setMessage({ kind: 'ok', text: t('saved') });
  }

  async function setArchived(goal: Goal, archived: boolean) {
    await createClient().from('goals').update({ archived, updated_at: new Date().toISOString() }).eq('id', goal.id);
    await reload();
  }

  async function remove(goal: Goal) {
    if (!window.confirm(t('confirmDelete', { name: goal.name }))) return;
    await createClient().from('goals').delete().eq('id', goal.id);
    await reload();
  }

  const openNew = () => {
    setMessage(null);
    setDraft({ ...EMPTY });
  };

  return (
    <div className={styles.tabBody}>
      <div className={styles.toolbar}>
        <p className={styles.intro}>{t('intro')}</p>
        {hasAny ? (
          <div className={styles.toolbarActions}>
            <button type="button" className="button buttonGhost" onClick={() => setShowArchived(!showArchived)} aria-pressed={showArchived}>
              {showArchived ? t('showActive') : t('showArchived')}
            </button>
            <button type="button" className="button buttonPrimary" onClick={openNew}>
              {t('newGoal')}
            </button>
          </div>
        ) : null}
      </div>

      {message?.kind === 'ok' ? (
        <p className={styles.notice} role="status">
          {message.text}
        </p>
      ) : null}

      {!hasAny ? (
        <div className={`emptyState ${styles.empty}`}>
          <p>{t('empty')}</p>
          <button type="button" className="button buttonPrimary" onClick={openNew}>
            {t('newGoal')}
          </button>
        </div>
      ) : goals.length === 0 ? (
        <p className={`emptyState ${styles.empty}`}>{showArchived ? t('noArchived') : t('empty')}</p>
      ) : (
        <ul className={styles.goals}>
          {goals.map((goal) => {
            const resume = data.resumes.find((item) => item.id === goal.resume_document_id);
            const playbook = data.playbooks.find((item) => item.id === goal.playbook_id);
            const role = goal.role?.trim();
            const company = goal.company?.trim();
            const who = role && company ? t('roleAt', { role, company }) : role || company || t('noRole');
            return (
              <li key={goal.id} className={styles.goal}>
                <div className={styles.goalMain}>
                  <h3 className={styles.goalName}>{goal.name}</h3>
                  <p className={styles.goalMeta}>
                    <span>{who}</span>
                    <span>{t(`rounds.${goal.round}`)}</span>
                  </p>
                </div>

                <ul className={styles.uses}>
                  <li data-missing={resume ? undefined : 'true'}>
                    <ResumeIcon size={16} />
                    <span>{resume ? t('usesResume', { name: resume.filename ?? t('resume') }) : t('noResume')}</span>
                  </li>
                  <li data-missing={goal.job_description ? undefined : 'true'}>
                    <FileTextIcon size={16} />
                    <span>{goal.job_description ? t('hasJob') : t('noJob')}</span>
                  </li>
                  <li data-missing={goal.material_ids.length ? undefined : 'true'}>
                    <LayersIcon size={16} />
                    <span>{t('materialCount', { count: goal.material_ids.length })}</span>
                  </li>
                  {playbook ? (
                    <li>
                      <BookIcon size={16} />
                      <span>{t('usesPlaybook', { name: playbook.name })}</span>
                    </li>
                  ) : null}
                </ul>

                <div className={styles.useActions}>
                  <Link className="button buttonSmall" href={`/copilot/live?goal=${goal.id}`}>
                    {t('startLive')}
                  </Link>
                  {/* Creates the practice interview with this goal's role, company, résumé and job filled in. */}
                  <NewPracticeButton small label={t('practice')} query={`goal=${goal.id}`} />
                </div>

                <div className={styles.manageActions}>
                  <button type="button" className="button buttonGhost buttonSmall" onClick={() => setDraft(draftFrom(goal))}>
                    {t('edit')}
                  </button>
                  <button type="button" className="button buttonGhost buttonSmall" onClick={() => void setArchived(goal, !goal.archived)}>
                    {goal.archived ? t('restore') : t('archive')}
                  </button>
                  {goal.archived ? (
                    <button type="button" className="button buttonGhost buttonSmall" onClick={() => void remove(goal)}>
                      {t('delete')}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {draft ? (
        <GoalEditor
          draft={draft}
          setDraft={setDraft}
          data={data}
          onSubmit={save}
          onClose={closeEditor}
          busy={busy}
          error={message?.kind === 'error' ? message.text : null}
        />
      ) : null}
    </div>
  );
}

function GoalEditor({
  draft,
  setDraft,
  data,
  onSubmit,
  onClose,
  busy,
  error,
}: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  data: WorkspaceData;
  onSubmit: (event: React.FormEvent) => void;
  onClose: () => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useTranslations('Goals');
  const ids = {
    name: useId(),
    company: useId(),
    role: useId(),
    round: useId(),
    resume: useId(),
    job: useId(),
    jd: useId(),
    playbook: useId(),
    playbookHelp: useId(),
    notes: useId(),
  };
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

  return (
    <Sheet
      title={draft.id ? t('editGoal') : t('newGoal')}
      onClose={onClose}
      onSubmit={onSubmit}
      footer={
        <>
          {error ? (
            <p className={styles.sheetError} role="alert">
              {error}
            </p>
          ) : null}
          <button type="button" className="button" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="button buttonPrimary" disabled={busy}>
            {busy ? t('saving') : t('save')}
          </button>
        </>
      }
    >
      <div className={styles.twoCol}>
        <label className="label" htmlFor={ids.role}>
          {t('role')}
          <input id={ids.role} className="input" value={draft.role} onChange={(e) => set({ role: e.target.value })} maxLength={200} />
        </label>
        <label className="label" htmlFor={ids.company}>
          {t('company')}
          <input id={ids.company} className="input" value={draft.company} onChange={(e) => set({ company: e.target.value })} maxLength={200} />
        </label>
        <label className="label" htmlFor={ids.round}>
          {t('round')}
          <select id={ids.round} className="select" value={draft.round} onChange={(e) => set({ round: e.target.value as GoalRound })}>
            {GOAL_ROUNDS.map((round) => (
              <option key={round} value={round}>
                {t(`rounds.${round}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="label" htmlFor={ids.name}>
          {t('name')}
          <input
            id={ids.name}
            className="input"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder={[draft.role, draft.company].filter(Boolean).join(' · ') || t('namePlaceholder')}
            maxLength={200}
          />
        </label>
      </div>

      <div className={styles.sheetGroup}>
        <div className={styles.twoCol}>
          <label className="label" htmlFor={ids.resume}>
            {t('resume')}
            <select id={ids.resume} className="select" value={draft.resume_document_id} onChange={(e) => set({ resume_document_id: e.target.value })}>
              <option value="">{t('none')}</option>
              {data.resumes.map((resume) => (
                <option key={resume.id} value={resume.id}>
                  {resume.filename ?? t('resume')}
                </option>
              ))}
            </select>
          </label>
          <label className="label" htmlFor={ids.job}>
            {t('jobBoard')}
            <select id={ids.job} className="select" value={draft.job_application_id} onChange={(e) => set({ job_application_id: e.target.value })}>
              <option value="">{t('none')}</option>
              {data.jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {t('roleAt', { role: job.title, company: job.company })}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="label" htmlFor={ids.jd}>
          {t('jobDescription')}
          <textarea
            id={ids.jd}
            className="textarea"
            rows={6}
            value={draft.job_description}
            onChange={(e) => set({ job_description: e.target.value })}
            placeholder={t('jobDescriptionPlaceholder')}
            maxLength={20_000}
          />
        </label>
      </div>

      <div className={styles.sheetGroup}>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>{t('materials')}</legend>
          {data.materials.length === 0 ? (
            <p className={styles.help}>{t('noMaterials')}</p>
          ) : (
            <div className={styles.checks}>
              {data.materials.map((material) => (
                <label key={material.id} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={draft.material_ids.includes(material.id)}
                    onChange={(e) =>
                      set({
                        material_ids: e.target.checked
                          ? [...draft.material_ids, material.id]
                          : draft.material_ids.filter((id) => id !== material.id),
                      })
                    }
                  />
                  <span>{material.title}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <label className="label" htmlFor={ids.playbook}>
          {t('playbook')}
          <select
            id={ids.playbook}
            className="select"
            value={draft.playbook_id}
            onChange={(e) => set({ playbook_id: e.target.value })}
            aria-describedby={ids.playbookHelp}
          >
            <option value="">{t('none')}</option>
            {data.playbooks.map((playbook) => (
              <option key={playbook.id} value={playbook.id}>
                {playbook.name}
              </option>
            ))}
          </select>
          <span id={ids.playbookHelp} className="help">
            {t('playbookHelp')}
          </span>
        </label>

        <label className="label" htmlFor={ids.notes}>
          {t('notes')}
          <textarea id={ids.notes} className="textarea" rows={3} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={4000} />
        </label>
      </div>
    </Sheet>
  );
}
