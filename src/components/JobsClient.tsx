'use client';

import { useState, useEffect, useId } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/browser';
import { Link } from '@/i18n/routing';
import { useToastHook } from '@/components/Toast';
import { LoadingSpinner } from '@/components/Skeleton';
import { SearchIcon } from '@/components/icons';

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

export function JobsClient() {
  const t = useTranslations('Jobs');
  const format = useFormatter();
  const stageLabel = (stage: ApplicationStage) => t(`stages.${stage}`);
  const shortDate = (iso: string, withTime = false) =>
    format.dateTime(new Date(iso), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
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
  const [announcement, setAnnouncement] = useState('');

  const searchId = useId();
  const filterGroupId = useId();

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
      toast.success(t('moved'), t('movedBody', { title: app?.title ?? '', stage: stageLabel(newStage) }));
    }
  };

  const deleteApplication = async (appId: string) => {
    const app = applications.find(a => a.id === appId);
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

  const filteredApps = applications.filter(app => {
    const matchesSearch = !searchQuery ||
      app.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (app.notes && app.notes.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStage = filterStage === 'all' || app.stage === filterStage;

    return matchesSearch && matchesStage;
  });

  const getAppsByStage = (stage: ApplicationStage) =>
    filteredApps.filter(app => app.stage === stage);

  const handleDragStart = (app: JobWithApplication) => {
    setDraggedItem(app);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (stage: ApplicationStage) => {
    if (draggedItem && draggedItem.stage !== stage) {
      updateStage(draggedItem.id, stage);
    }
    setDraggedItem(null);
  };

  const getStageCount = (stage: ApplicationStage) => applications.filter(a => a.stage === stage).length;
  const totalApps = applications.length;

  if (loading) {
    return (
      <LoadingSpinner text={t('loading')} />
    );
  }

  return (
    <div className="jobsContainer">
      {/* Screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="srOnly"
      >
        {announcement}
      </div>

      {/* Header Stats */}
      <div className="jobsStats" role="region" aria-label={t('statsLabel')}>
        <div className="statItem">
          <span className="statValue">{totalApps}</span>
          <span className="statLabel">{t('statApplications')}</span>
        </div>
        <div className="statItem">
          <span className="statValue">{getStageCount('interview') + getStageCount('offer')}</span>
          <span className="statLabel">{t('statInterviewing')}</span>
        </div>
        <div className="statItem">
          <span className="statValue">{getStageCount('offer')}</span>
          <span className="statLabel">{t('statOffers')}</span>
        </div>
      </div>

      {/* Search and Filter Bar */}
      <div className="jobsToolbar" role="search" aria-label={t('searchLabel')}>
        <div className="searchBox">
          <SearchIcon size={18} className="searchIcon" />
          <input
            type="text"
            placeholder={t('searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="searchInput"
            id={searchId}
            aria-describedby="search-description"
          />
          <span id="search-description" className="srOnly">
            {t('searchHelp')}
          </span>
        </div>

        <div
          className="filterButtons"
          role="group"
          aria-label={t('filterLabel')}
          id={filterGroupId}
        >
          <button
            className={`filterBtn ${filterStage === 'all' ? 'active' : ''}`}
            onClick={() => setFilterStage('all')}
            aria-pressed={filterStage === 'all'}
          >
            {t('all', { count: totalApps })}
          </button>
          {STAGE_ORDER.slice(0, 5).map(stage => (
            <button
              key={stage}
              className={`filterBtn ${filterStage === stage ? 'active' : ''}`}
              onClick={() => setFilterStage(stage)}
              aria-pressed={filterStage === stage}
            >
              {stageLabel(stage)} ({getStageCount(stage)})
            </button>
          ))}
        </div>

        <button className="button buttonPrimary" onClick={() => setShowAddModal(true)}>
          {t('add')}
        </button>
      </div>

      {/* Kanban Board */}
      <div
        className="kanbanBoard"
        role="region"
        aria-label={t('boardLabel')}
      >
        {STAGE_ORDER.map(stage => (
          <div
            key={stage}
            className={`kanbanColumn ${filterStage !== 'all' && filterStage !== stage ? 'dimmed' : ''}`}
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(stage)}
            role="listbox"
            aria-label={t('columnLabel', { stage: stageLabel(stage), count: getAppsByStage(stage).length })}
            aria-readonly="true"
            tabIndex={0}
          >
            <div className="columnHeader">
              <span className="columnTitle">{stageLabel(stage)}</span>
              <span className="columnCount" aria-hidden="true">
                {getAppsByStage(stage).length}
              </span>
            </div>
            <div className="columnContent">
              {getAppsByStage(stage).map(app => (
                <div
                  key={app.id}
                  className="jobCard"
                  draggable
                  onDragStart={() => handleDragStart(app)}
                  role="option"
                  aria-selected="false"
                  aria-label={t('cardLabel', { title: app.title, company: app.company })}
                >
                  <div className="jobCardHeader">
                    <span className="jobCompany">{app.company}</span>
                    <span className="jobCardActions">
                      <Link className="editBtn" href={`/goals?fromJob=${app.id}`} title={t('goalHelp')}>
                        {t('goal')}
                      </Link>
                      <button
                        className="editBtn"
                        onClick={() => setEditing(app)}
                        aria-label={t('editLabel', { title: app.title, company: app.company })}
                      >
                        {t('edit')}
                      </button>
                      <button
                        className="deleteBtn"
                        onClick={() => deleteApplication(app.id)}
                        title={t('delete')}
                        aria-label={t('deleteLabel', { title: app.title, company: app.company })}
                      >
                        ×
                      </button>
                    </span>
                  </div>
                  <div className="jobTitle">{app.title}</div>
                  {app.notes && <div className="jobNotes">{app.notes}</div>}
                  {app.interview_at && new Date(app.interview_at).getTime() > Date.now() ? (
                    <div className="jobDue interview">{t('interviewOn', { when: shortDate(app.interview_at, true) })}</div>
                  ) : null}
                  {app.next_followup_at && app.stage !== 'offer' && app.stage !== 'rejected' ? (
                    <div className={`jobDue ${new Date(app.next_followup_at).getTime() <= Date.now() ? 'overdue' : ''}`}>
                      {t('followUpOn', { when: shortDate(app.next_followup_at) })}
                    </div>
                  ) : null}
                  <div className="jobMeta">
                    <span className="jobDate">
                      {app.applied_at
                        ? t('appliedOn', { date: format.dateTime(new Date(app.applied_at), { dateStyle: 'medium' }) })
                        : t('addedOn', { date: format.dateTime(new Date(app.created_at), { dateStyle: 'medium' }) })}
                    </span>
                  </div>
                </div>
              ))}
              {getAppsByStage(stage).length === 0 && (
                <div className="emptyColumn" aria-live="polite">
                  {filterStage === 'all' ? t('emptyColumn') : t('noMatches')}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add / edit job */}
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

      <style jsx>{`
        .jobsContainer {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .jobsStats {
          display: flex;
          gap: 24px;
          padding: 16px 20px;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 12px;
          border: 1px solid var(--border);
        }

        .statItem {
          display: flex;
          flex-direction: column;
        }

        .statValue {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text);
        }

        .statLabel {
          font-size: 0.8rem;
          color: var(--text-light);
        }

        .jobsToolbar {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }

        .searchBox {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 44px;
          padding: 0 14px;
          background: var(--well);
          border: 1px solid var(--line);
          border-radius: 10px;
          flex: 1;
          min-width: 250px;
          color: var(--mist);
        }

        .searchBox:focus-within {
          border-color: var(--ember);
          box-shadow: 0 0 0 3px var(--ember-soft);
        }

        .searchInput {
          background: transparent;
          border: none;
          color: var(--paper);
          flex: 1;
          outline: none;
          font: inherit;
          font-size: 15px;
        }

        .searchInput::placeholder {
          color: var(--text-light);
        }

        .filterButtons {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .filterBtn {
          min-height: 34px;
          padding: 0 12px;
          background: transparent;
          border: 1px solid var(--line);
          border-radius: 999px;
          color: var(--mist);
          font: inherit;
          font-size: 13.5px;
          cursor: pointer;
          transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
        }

        .filterBtn:hover {
          background: var(--deck-2);
          color: var(--paper);
        }

        .filterBtn.active {
          background: var(--ember-soft);
          border-color: rgba(255, 181, 71, 0.5);
          color: var(--ember-text);
        }

        .jobCardActions {
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }

        .editBtn {
          background: none;
          border: none;
          color: var(--mist);
          font: inherit;
          font-size: 12px;
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 6px;
        }

        .editBtn:hover,
        .editBtn:focus-visible {
          color: var(--paper);
          background: var(--deck-2);
        }

        .jobDue {
          margin-top: 6px;
          font-size: 12px;
          color: var(--mist);
        }

        .jobDue.interview {
          color: var(--ice);
        }

        .jobDue.overdue {
          color: var(--ember);
        }

        .kanbanBoard {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 12px;
          overflow-x: auto;
          padding-bottom: 12px;
        }

        .kanbanColumn {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border);
          border-radius: 10px;
          min-width: 160px;
          display: flex;
          flex-direction: column;
        }

        .kanbanColumn.dimmed {
          opacity: 0.4;
        }

        .columnHeader {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px;
          border-bottom: 1px solid var(--border);
        }

        .columnTitle {
          font-weight: 600;
          font-size: 0.85rem;
        }

        .columnCount {
          background: rgba(255, 255, 255, 0.1);
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 0.75rem;
        }

        .columnContent {
          padding: 8px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-height: 200px;
          max-height: 400px;
          overflow-y: auto;
        }

        .jobCard {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 10px;
          cursor: grab;
          transition: transform 0.15s, box-shadow 0.15s;
        }

        .jobCard:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .jobCard:focus-visible {
          outline: 3px solid var(--focus-ring);
          outline-offset: 2px;
        }

        .jobCard:active {
          cursor: grabbing;
        }

        .jobCardHeader {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }

        .jobCompany {
          font-weight: 600;
          font-size: 0.9rem;
          color: var(--text);
        }

        .deleteBtn {
          background: none;
          border: none;
          color: var(--text-light);
          cursor: pointer;
          padding: 0;
          font-size: 1.1rem;
          line-height: 1;
          opacity: 0.5;
          transition: opacity 0.2s;
        }

        .deleteBtn:hover {
          opacity: 1;
          color: #ef4444;
        }

        .deleteBtn:focus-visible {
          outline: 2px solid var(--focus-ring);
          outline-offset: 2px;
          opacity: 1;
        }

        .jobTitle {
          font-size: 0.8rem;
          color: var(--text-light);
          margin-top: 4px;
        }

        .jobNotes {
          font-size: 0.75rem;
          color: var(--text-light);
          margin-top: 6px;
          padding-top: 6px;
          border-top: 1px solid var(--border);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .jobMeta {
          margin-top: 8px;
        }

        .jobDate {
          font-size: 0.7rem;
          color: var(--text-light);
          opacity: 0.7;
        }

        .emptyColumn {
          text-align: center;
          padding: 20px 10px;
          color: var(--text-light);
          font-size: 0.8rem;
          opacity: 0.6;
        }

        @media (max-width: 1200px) {
          .kanbanBoard {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        @media (max-width: 768px) {
          .kanbanBoard {
            grid-template-columns: 1fr;
            gap: 16px;
          }

          .jobsToolbar {
            flex-direction: column;
            align-items: stretch;
          }

          .jobsStats {
            flex-direction: column;
            gap: 16px;
            text-align: center;
          }

          .searchBox {
            min-width: 100%;
          }

          .filterButtons {
            overflow-x: auto;
            flex-wrap: nowrap;
            padding-bottom: 8px;
          }

          .filterBtn {
            white-space: nowrap;
          }

          .modalContent {
            margin: 16px;
            max-width: calc(100% - 32px);
          }
        }

        @media (max-width: 480px) {
          .jobsStats {
            padding: 12px;
          }

          .statValue {
            font-size: 1.25rem;
          }

          .columnHeader {
            padding: 10px;
          }

          .jobCard {
            padding: 8px;
          }
        }
      `}</style>
    </div>
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
  const ids = { company: useId(), title: useId(), url: useId(), stage: useId(), interview: useId(), followUp: useId(), notes: useId() };

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
      className="modalOverlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={modalTitleId}
      onKeyDown={handleKeyDown}
    >
      <div className="modalContent" onClick={e => e.stopPropagation()}>
        <div className="modalHeader">
          <h3 id={modalTitleId}>{initial ? t('editTitle') : t('add')}</h3>
          <button
            className="closeBtn"
            onClick={onClose}
            aria-label={t('close')}
          >×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="formRow">
            <div className="formGroup">
              <label htmlFor={ids.company}>{t('company')}</label>
              <input type="text" id={ids.company} value={company} onChange={e => setCompany(e.target.value)} placeholder={t('companyPlaceholder')} required autoFocus />
            </div>
            <div className="formGroup">
              <label htmlFor={ids.title}>{t('title')}</label>
              <input type="text" id={ids.title} value={title} onChange={e => setTitle(e.target.value)} placeholder={t('titlePlaceholder')} required />
            </div>
          </div>
          <div className="formRow">
            <div className="formGroup">
              <label htmlFor={ids.url}>{t('link')}</label>
              <input type="url" id={ids.url} value={jobUrl} onChange={e => setJobUrl(e.target.value)} placeholder={t('linkPlaceholder')} />
            </div>
            <div className="formGroup">
              <label htmlFor={ids.stage}>{t('stage')}</label>
              <select id={ids.stage} value={stage} onChange={e => setStage(e.target.value as ApplicationStage)}>
                {STAGE_ORDER.map(option => (
                  <option key={option} value={option}>{t(`stages.${option}`)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="formRow">
            <div className="formGroup">
              <label htmlFor={ids.interview}>{t('interviewAt')}</label>
              <input type="datetime-local" id={ids.interview} value={interviewAt} onChange={e => setInterviewAt(e.target.value)} />
            </div>
            <div className="formGroup">
              <label htmlFor={ids.followUp}>{t('followUp')}</label>
              <input type="date" id={ids.followUp} value={followUp} onChange={e => setFollowUp(e.target.value)} />
            </div>
          </div>
          <p className="formHelp">{t('remindersHelp')}</p>
          <div className="formGroup">
            <label htmlFor={ids.notes}>{t('notes')}</label>
            <textarea id={ids.notes} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('notesPlaceholder')} rows={3} />
          </div>
          <div className="modalActions">
            <button type="button" className="button" onClick={onClose}>{t('cancel')}</button>
            <button type="submit" className="button buttonPrimary">{initial ? t('save') : t('addJob')}</button>
          </div>
        </form>
      </div>

      <style jsx>{`
        .modalOverlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
        }

        .modalContent {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 12px;
          width: calc(100% - 32px);
          max-width: 560px;
          max-height: calc(100vh - 32px);
          overflow: auto;
          padding: 20px;
        }

        .formRow {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        @media (max-width: 560px) {
          .formRow {
            grid-template-columns: 1fr;
          }
        }

        .formHelp {
          margin: -6px 0 16px;
          font-size: 0.8rem;
          color: var(--mist);
        }

        .modalHeader {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .modalHeader h3 {
          margin: 0;
          font-size: 1.1rem;
        }

        .closeBtn {
          background: none;
          border: none;
          color: var(--text-light);
          font-size: 1.5rem;
          cursor: pointer;
          padding: 0;
          line-height: 1;
        }

        .closeBtn:focus-visible {
          outline: 2px solid var(--focus-ring);
          outline-offset: 2px;
        }

        .formGroup {
          margin-bottom: 16px;
        }

        .formGroup label {
          display: block;
          font-size: 0.85rem;
          margin-bottom: 6px;
          color: var(--text-light);
        }

        .formGroup input,
        .formGroup select,
        .formGroup textarea {
          width: 100%;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          font: inherit;
          font-size: 0.9rem;
          color-scheme: dark;
        }

        .formGroup input:focus,
        .formGroup select:focus,
        .formGroup textarea:focus {
          outline: none;
          border-color: var(--primary);
        }

        .formGroup input:focus-visible,
        .formGroup textarea:focus-visible {
          outline: 2px solid var(--focus-ring);
          outline-offset: 2px;
        }

        .modalActions {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          margin-top: 20px;
        }

      `}</style>
    </div>
  );
}
