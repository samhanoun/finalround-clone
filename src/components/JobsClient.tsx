'use client';

import { useState, useEffect, useId, useSyncExternalStore } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/browser';
import { Link } from '@/i18n/routing';
import { useToastHook } from '@/components/Toast';
import { LoadingSpinner } from '@/components/Skeleton';
import { CalendarIcon, ClockIcon, CloseIcon, MoreIcon, PencilIcon, SearchIcon, TargetIcon, TrashIcon } from '@/components/icons';
import styles from './JobsClient.module.css';

type ApplicationStage = 'saved' | 'applied' | 'oa' | 'interview' | 'offer' | 'rejected';

interface Job {
  id: string;
  user_id: string;
  external_source: string | null;
  external_id: string | null;
  company: string;
  title: string;
  location: string | null;
  remote_type: string | null;
  salary_min: number | null;
  salary_max: number | null;
  job_description: string | null;
  job_url: string | null;
  posted_at: string | null;
  created_at: string;
}

interface JobApplication {
  id: string;
  user_id: string;
  job_id: string | null;
  stage: ApplicationStage;
  status: string;
  applied_at: string | null;
  next_followup_at: string | null;
  interview_at: string | null;
  job_url: string | null;
  notes: string | null;
  company: string;
  title: string;
  created_at: string;
}

interface JobWithApplication extends JobApplication {
  job?: Job;
}

const STAGE_ORDER: ApplicationStage[] = ['saved', 'applied', 'oa', 'interview', 'offer', 'rejected'];

/** ISO → the value a datetime-local input shows (local time). */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Phones get one list, filtered by stage, instead of six columns. */
const PHONE = '(max-width: 767px)';
function subscribeToPhone(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(PHONE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
function usePhone(): boolean {
  return useSyncExternalStore(
    subscribeToPhone,
    () => typeof window.matchMedia === 'function' && window.matchMedia(PHONE).matches,
    () => false,
  );
}

export function JobsClient() {
  const t = useTranslations('Jobs');
  const format = useFormatter();
  const isPhone = usePhone();
  const stageLabel = (stage: ApplicationStage) => t(`stages.${stage}`);
  const shortDate = (iso: string, withTime = false) =>
    format.dateTime(new Date(iso), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
    });
  const supabase = createClient();
  const toast = useToastHook();
  const [applications, setApplications] = useState<JobWithApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStage, setFilterStage] = useState<ApplicationStage | 'all'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editing, setEditing] = useState<JobWithApplication | null>(null);
  const [draggedItem, setDraggedItem] = useState<JobWithApplication | null>(null);
  const [dragOver, setDragOver] = useState<ApplicationStage | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  // When the board was opened: what counts as upcoming or overdue on the cards.
  const [now] = useState(() => Date.now());

  const searchId = useId();
  const searchHelpId = useId();

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      setLoading(true);
      const { data, error } = await supabase
        .from('job_applications')
        .select('*')
        .eq('status', 'active')
        .order('updated_at', { ascending: false });

      if (mounted && !error && data) {
        setApplications(data as JobWithApplication[]);
      }
      if (mounted) {
        setLoading(false);
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [supabase]);

  // An open card menu closes on Escape (focus goes back to its button) or a click anywhere else.
  useEffect(() => {
    if (!menuFor) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(`[data-menu="${menuFor}"]`)) return;
      setMenuFor(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const trigger = document.querySelector<HTMLElement>(`[data-menu-trigger="${menuFor}"]`);
      setMenuFor(null);
      trigger?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuFor]);

  const announce = (message: string) => {
    setAnnouncement(message);
    setTimeout(() => setAnnouncement(''), 1000);
  };

  const refreshApplications = async () => {
    const { data, error } = await supabase
      .from('job_applications')
      .select('*')
      .eq('status', 'active')
      .order('updated_at', { ascending: false });

    if (!error && data) {
      setApplications(data as JobWithApplication[]);
    }
  };

  const updateStage = async (appId: string, newStage: ApplicationStage) => {
    const updates: Partial<JobApplication> = { stage: newStage };
    const app = applications.find(a => a.id === appId);

    if (newStage === 'applied' && !app?.applied_at) {
      updates.applied_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('job_applications')
      .update(updates)
      .eq('id', appId);

    if (!error) {
      setApplications(prev =>
        prev.map(app =>
          app.id === appId ? { ...app, ...updates, updated_at: new Date().toISOString() } : app
        )
      );
      const body = t('movedBody', { title: app?.title ?? '', stage: stageLabel(newStage) });
      toast.success(t('moved'), body);
      announce(body);
    } else {
      toast.error(t('notSaved'), t('tryAgain'));
    }
  };

  const deleteApplication = async (appId: string) => {
    const app = applications.find(a => a.id === appId);
    // Deleting a job also drops its notes and dates, so it asks first.
    if (app && !window.confirm(t('confirmDelete', { title: app.title, company: app.company }))) return;
    const { error } = await supabase
      .from('job_applications')
      .delete()
      .eq('id', appId);

    if (!error) {
      setApplications(prev => prev.filter(app => app.id !== appId));
      toast.success(t('deleted'), t('deletedBody', { title: app?.title ?? '' }));
    } else {
      toast.error(t('notDeleted'), t('tryAgain'));
    }
  };

  const addJob = async (jobData: JobFormData) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('job_applications')
      .insert({
        user_id: user.id,
        company: jobData.company,
        title: jobData.title,
        stage: jobData.stage ?? 'saved',
        status: 'active',
        notes: jobData.notes || null,
        job_url: jobData.job_url || null,
        interview_at: jobData.interview_at,
        next_followup_at: jobData.next_followup_at,
        applied_at: jobData.stage && jobData.stage !== 'saved' ? new Date().toISOString() : null,
      });

    if (!error) {
      setShowAddModal(false);
      refreshApplications();
      toast.success(t('added'), t('jobAt', { title: jobData.title, company: jobData.company }));
    } else {
      toast.error(t('notAdded'), t('tryAgain'));
    }
  };

  const saveJob = async (appId: string, jobData: JobFormData) => {
    const app = applications.find(a => a.id === appId);
    const updates = {
      company: jobData.company,
      title: jobData.title,
      notes: jobData.notes || null,
      job_url: jobData.job_url || null,
      interview_at: jobData.interview_at,
      next_followup_at: jobData.next_followup_at,
      stage: jobData.stage ?? app?.stage ?? 'saved',
      ...(jobData.stage && jobData.stage !== 'saved' && !app?.applied_at ? { applied_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('job_applications').update(updates).eq('id', appId);
    if (error) {
      toast.error(t('notSaved'), t('tryAgain'));
      return;
    }
    setApplications(prev => prev.map(a => (a.id === appId ? { ...a, ...updates } : a)));
    setEditing(null);
    toast.success(
      t('saved'),
      updates.interview_at || updates.next_followup_at ? t('reminders') : t('jobAt', { title: jobData.title, company: jobData.company }),
    );
  };

  const query = searchQuery.trim().toLowerCase();
  const filteredApps = applications.filter(app => {
    const matchesSearch = !query ||
      app.company.toLowerCase().includes(query) ||
      app.title.toLowerCase().includes(query) ||
      (app.notes && app.notes.toLowerCase().includes(query));

    const matchesStage = filterStage === 'all' || app.stage === filterStage;

    return matchesSearch && matchesStage;
  });

  const getAppsByStage = (stage: ApplicationStage) =>
    filteredApps.filter(app => app.stage === stage);

  const handleDrop = (stage: ApplicationStage) => {
    if (draggedItem && draggedItem.stage !== stage) {
      updateStage(draggedItem.id, stage);
    }
    setDraggedItem(null);
    setDragOver(null);
  };

  const getStageCount = (stage: ApplicationStage) => applications.filter(a => a.stage === stage).length;
  const totalApps = applications.length;

  if (loading) {
    return (
      <LoadingSpinner text={t('loading')} />
    );
  }

  const modals = (
    <>
      {showAddModal && (
        <JobModal
          onClose={() => setShowAddModal(false)}
          onSubmit={addJob}
        />
      )}
      {editing && (
        <JobModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={(data) => saveJob(editing.id, data)}
        />
      )}
    </>
  );

  // No jobs at all: one sentence and one action, instead of six empty columns.
  if (totalApps === 0) {
    return (
      <div className={styles.jobs}>
        <div className={styles.firstRun}>
          <p className={styles.firstRunText}>{t('firstRun')}</p>
          <button type="button" className="button buttonPrimary" onClick={() => setShowAddModal(true)}>
            {t('add')}
          </button>
        </div>
        {modals}
      </div>
    );
  }

  const card = (app: JobWithApplication, draggable: boolean) => (
    <JobCard
      key={app.id}
      app={app}
      draggable={draggable}
      dragging={draggedItem?.id === app.id}
      menuOpen={menuFor === app.id}
      now={now}
      shortDate={shortDate}
      onDragStart={() => {
        setMenuFor(null);
        setDraggedItem(app);
      }}
      onDragEnd={() => {
        setDraggedItem(null);
        setDragOver(null);
      }}
      onMenu={() => setMenuFor(menuFor === app.id ? null : app.id)}
      onEdit={() => {
        setMenuFor(null);
        setEditing(app);
      }}
      onMove={(stage) => {
        setMenuFor(null);
        if (stage !== app.stage) void updateStage(app.id, stage);
      }}
      onDelete={() => {
        setMenuFor(null);
        void deleteApplication(app.id);
      }}
    />
  );

  const noResults = filteredApps.length === 0;
  const phoneStages = filterStage === 'all' ? STAGE_ORDER.filter(stage => getAppsByStage(stage).length > 0) : [filterStage];

  return (
    <div className={styles.jobs}>
      {/* Screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="srOnly"
      >
        {announcement}
      </div>

      <div className={styles.toolbar}>
        <div className={styles.searchBox} role="search" aria-label={t('searchLabel')}>
          <SearchIcon size={16} className={styles.searchIcon} />
          <input
            type="search"
            placeholder={t('searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.searchInput}
            id={searchId}
            aria-label={t('search')}
            aria-describedby={searchHelpId}
          />
          <span id={searchHelpId} className="srOnly">
            {t('searchHelp')}
          </span>
        </div>

        <div className={styles.summary} role="group" aria-label={t('statsLabel')}>
          <span>{t.rich('summaryJobs', { count: totalApps, n: (chunks) => <span className={styles.summaryNum}>{chunks}</span> })}</span>
          <span>
            {t.rich('summaryInterviewing', {
              count: getStageCount('interview') + getStageCount('offer'),
              n: (chunks) => <span className={styles.summaryNum}>{chunks}</span>,
            })}
          </span>
          <span>{t.rich('summaryOffers', { count: getStageCount('offer'), n: (chunks) => <span className={styles.summaryNum}>{chunks}</span> })}</span>
        </div>

        <button type="button" className={`button buttonPrimary ${styles.addButton}`} onClick={() => setShowAddModal(true)}>
          {t('add')}
        </button>
      </div>

      <div className={styles.tabs} role="group" aria-label={t('filterLabel')}>
        {(['all', ...STAGE_ORDER] as const).map(stage => (
          <button
            key={stage}
            type="button"
            className={styles.tab}
            onClick={() => setFilterStage(stage)}
            aria-pressed={filterStage === stage}
          >
            {stage === 'all' ? t('all') : stageLabel(stage)}
            <span className={styles.tabCount}>{stage === 'all' ? totalApps : getStageCount(stage)}</span>
          </button>
        ))}
      </div>

      {noResults ? (
        <p className={styles.noResults} role="status">
          {query ? t('noMatches') : t('stageEmpty', { stage: filterStage === 'all' ? t('all') : stageLabel(filterStage) })}
        </p>
      ) : null}

      {isPhone ? (
        noResults ? null : (
          <div className={styles.phoneList}>
            {phoneStages.map(stage => {
              const apps = getAppsByStage(stage);
              return (
                <div key={stage} className={styles.group} role="group" aria-label={t('columnLabel', { stage: stageLabel(stage), count: apps.length })}>
                  {filterStage === 'all' ? (
                    <h2 className={styles.groupTitle} aria-hidden="true">
                      {stageLabel(stage)}
                      <span className={styles.columnCount}>{apps.length}</span>
                    </h2>
                  ) : null}
                  <ul className={styles.cards}>{apps.map(app => card(app, false))}</ul>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div className={styles.board} role="region" aria-label={t('boardLabel')}>
          {STAGE_ORDER.map(stage => {
            const apps = getAppsByStage(stage);
            return (
              <div
                key={stage}
                className={styles.column}
                data-dimmed={filterStage !== 'all' && filterStage !== stage}
                role="group"
                aria-label={t('columnLabel', { stage: stageLabel(stage), count: apps.length })}
              >
                <div className={styles.columnHead} aria-hidden="true">
                  <span className={styles.columnTitle}>{stageLabel(stage)}</span>
                  <span className={styles.columnCount}>{apps.length}</span>
                </div>
                <ul
                  className={styles.columnBody}
                  data-empty={apps.length === 0}
                  data-over={dragOver === stage && draggedItem?.stage !== stage}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragOver !== stage) setDragOver(stage);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(null);
                  }}
                  onDrop={() => handleDrop(stage)}
                >
                  {apps.map(app => card(app, true))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {modals}
    </div>
  );
}

function JobCard({
  app,
  draggable,
  dragging,
  menuOpen,
  now,
  shortDate,
  onDragStart,
  onDragEnd,
  onMenu,
  onEdit,
  onMove,
  onDelete,
}: {
  app: JobWithApplication;
  draggable: boolean;
  dragging: boolean;
  menuOpen: boolean;
  now: number;
  shortDate: (iso: string, withTime?: boolean) => string;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMenu: () => void;
  onEdit: () => void;
  onMove: (stage: ApplicationStage) => void;
  onDelete: () => void;
}) {
  const t = useTranslations('Jobs');
  const format = useFormatter();
  const menuId = useId();
  const moveId = useId();
  const names = { title: app.title, company: app.company };
  const interviewAhead = app.interview_at && new Date(app.interview_at).getTime() > now;
  const followUp = app.next_followup_at && app.stage !== 'offer' && app.stage !== 'rejected' ? app.next_followup_at : null;
  const overdue = followUp ? new Date(followUp).getTime() <= now : false;

  return (
    <li className={styles.item} data-menu={app.id} data-open={menuOpen}>
      <div
        className={styles.card}
        data-dragging={dragging}
        draggable={draggable}
        onDragStart={draggable ? onDragStart : undefined}
        onDragEnd={draggable ? onDragEnd : undefined}
      >
        <div className={styles.cardHead}>
          <span className={styles.company}>{app.company}</span>
          <button
            type="button"
            className={styles.menuButton}
            onClick={onMenu}
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            aria-label={t('actionsLabel', names)}
            data-menu-trigger={app.id}
          >
            <MoreIcon size={16} />
          </button>
        </div>
        <div className={styles.jobTitle}>{app.title}</div>
        {app.notes && <div className={styles.notes}>{app.notes}</div>}
        {interviewAhead ? (
          <div className={`${styles.due} ${styles.dueInterview}`}>
            <CalendarIcon size={14} />
            <span>{t('interviewOn', { when: shortDate(app.interview_at as string, true) })}</span>
          </div>
        ) : null}
        {followUp ? (
          <div className={`${styles.due} ${overdue ? styles.dueOverdue : ''}`}>
            <ClockIcon size={14} />
            <span>{overdue ? t('followUpOverdue', { when: shortDate(followUp) }) : t('followUpOn', { when: shortDate(followUp) })}</span>
          </div>
        ) : null}
        <div className={styles.date}>
          {app.applied_at
            ? t('appliedOn', { date: format.dateTime(new Date(app.applied_at), { dateStyle: 'medium' }) })
            : t('addedOn', { date: format.dateTime(new Date(app.created_at), { dateStyle: 'medium' }) })}
        </div>
      </div>

      {menuOpen ? (
        <div id={menuId} className={styles.menu} role="group" aria-label={t('actionsLabel', names)}>
          <button type="button" className={styles.menuItem} onClick={onEdit} aria-label={t('editLabel', names)}>
            <PencilIcon size={16} />
            {t('edit')}
          </button>
          <Link className={styles.menuItemLink} href={`/goals?fromJob=${app.id}`} title={t('goalHelp')}>
            <TargetIcon size={16} />
            {t('makeGoal')}
          </Link>
          <div className={styles.menuMove}>
            <label className={styles.menuLabel} htmlFor={moveId}>
              {t('moveTo')}
            </label>
            <select
              id={moveId}
              className={`select ${styles.menuSelect}`}
              value={app.stage}
              onChange={(e) => onMove(e.target.value as ApplicationStage)}
            >
              {STAGE_ORDER.map(option => (
                <option key={option} value={option}>{t(`stages.${option}`)}</option>
              ))}
            </select>
          </div>
          <button type="button" className={`${styles.menuItem} ${styles.danger}`} onClick={onDelete} aria-label={t('deleteLabel', names)}>
            <TrashIcon size={16} />
            {t('delete')}
          </button>
        </div>
      ) : null}
    </li>
  );
}

interface JobFormData {
  company: string;
  title: string;
  job_url?: string;
  notes?: string;
  stage?: ApplicationStage;
  interview_at: string | null;
  next_followup_at: string | null;
}

function JobModal({
  initial,
  onClose,
  onSubmit,
}: {
  initial?: JobWithApplication;
  onClose: () => void;
  onSubmit: (data: JobFormData) => void;
}) {
  const t = useTranslations('Jobs');
  const [company, setCompany] = useState(initial?.company ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [jobUrl, setJobUrl] = useState(initial?.job_url ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [stage, setStage] = useState<ApplicationStage>(initial?.stage ?? 'saved');
  const [interviewAt, setInterviewAt] = useState(toLocalInput(initial?.interview_at ?? null));
  const [followUp, setFollowUp] = useState(toLocalInput(initial?.next_followup_at ?? null).slice(0, 10));
  const modalTitleId = useId();
  const ids = { company: useId(), title: useId(), url: useId(), stage: useId(), interview: useId(), followUp: useId(), notes: useId(), help: useId() };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!company.trim() || !title.trim()) return;
    onSubmit({
      company: company.trim(),
      title: title.trim(),
      job_url: jobUrl.trim(),
      notes: notes.trim(),
      stage,
      interview_at: interviewAt ? new Date(interviewAt).toISOString() : null,
      // A follow-up date reminds you at 09:00 that day.
      next_followup_at: followUp ? new Date(`${followUp}T09:00`).toISOString() : null,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className={styles.overlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={modalTitleId}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        <div className={styles.dialogHead}>
          <h2 id={modalTitleId} className={styles.dialogTitle}>{initial ? t('editTitle') : t('add')}</h2>
          <button
            type="button"
            className="iconButton"
            onClick={onClose}
            aria-label={t('close')}
          >
            <CloseIcon size={18} />
          </button>
        </div>
        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.formRow}>
            <div className={styles.field}>
              <label className="label" htmlFor={ids.company}>{t('company')}</label>
              <input className="input" type="text" id={ids.company} value={company} onChange={e => setCompany(e.target.value)} placeholder={t('companyPlaceholder')} required autoFocus />
            </div>
            <div className={styles.field}>
              <label className="label" htmlFor={ids.title}>{t('title')}</label>
              <input className="input" type="text" id={ids.title} value={title} onChange={e => setTitle(e.target.value)} placeholder={t('titlePlaceholder')} required />
            </div>
          </div>
          <div className={styles.formRow}>
            <div className={styles.field}>
              <label className="label" htmlFor={ids.url}>{t('link')}</label>
              <input className="input" type="url" id={ids.url} value={jobUrl} onChange={e => setJobUrl(e.target.value)} placeholder={t('linkPlaceholder')} />
            </div>
            <div className={styles.field}>
              <label className="label" htmlFor={ids.stage}>{t('stage')}</label>
              <select className="select" id={ids.stage} value={stage} onChange={e => setStage(e.target.value as ApplicationStage)}>
                {STAGE_ORDER.map(option => (
                  <option key={option} value={option}>{t(`stages.${option}`)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className={styles.formRow}>
            <div className={styles.field}>
              <label className="label" htmlFor={ids.interview}>{t('interviewAt')}</label>
              <input className="input" type="datetime-local" id={ids.interview} value={interviewAt} onChange={e => setInterviewAt(e.target.value)} aria-describedby={ids.help} />
            </div>
            <div className={styles.field}>
              <label className="label" htmlFor={ids.followUp}>{t('followUp')}</label>
              <input className="input" type="date" id={ids.followUp} value={followUp} onChange={e => setFollowUp(e.target.value)} aria-describedby={ids.help} />
            </div>
          </div>
          <p className="help" id={ids.help}>{t('remindersHelp')}</p>
          <div className={styles.field}>
            <label className="label" htmlFor={ids.notes}>{t('notes')}</label>
            <textarea className="textarea" id={ids.notes} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('notesPlaceholder')} rows={3} />
          </div>
          <div className={styles.dialogActions}>
            <button type="button" className="button" onClick={onClose}>{t('cancel')}</button>
            <button type="submit" className="button buttonPrimary">{initial ? t('save') : t('addJob')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
