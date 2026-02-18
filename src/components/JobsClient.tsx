'use client';

import { useState, useEffect, useId } from 'react';
import { createClient } from '@/lib/supabase/browser';

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
  notes: string | null;
  company: string;
  title: string;
  created_at: string;
}

interface JobWithApplication extends JobApplication {
  job?: Job;
}

const STAGE_LABELS: Record<ApplicationStage, string> = {
  saved: 'Saved',
  applied: 'Applied',
  oa: 'Online Assessment',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
};

const STAGE_ORDER: ApplicationStage[] = ['saved', 'applied', 'oa', 'interview', 'offer', 'rejected'];

export function JobsClient() {
  const supabase = createClient();
  const [applications, setApplications] = useState<JobWithApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStage, setFilterStage] = useState<ApplicationStage | 'all'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
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
      const oldStage = app?.stage;
      setApplications(prev =>
        prev.map(app =>
          app.id === appId ? { ...app, ...updates, updated_at: new Date().toISOString() } : app
        )
      );
      announce(`Moved ${app?.title} from ${STAGE_LABELS[oldStage || 'saved']} to ${STAGE_LABELS[newStage]}`);
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
      announce(`Deleted ${app?.title} application`);
    }
  };

  const addJob = async (jobData: { company: string; title: string; job_url?: string; notes?: string }) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('job_applications')
      .insert({
        user_id: user.id,
        company: jobData.company,
        title: jobData.title,
        stage: 'saved',
        status: 'active',
        notes: jobData.notes,
      });

    if (!error) {
      setShowAddModal(false);
      refreshApplications();
      announce(`Added new job application for ${jobData.title} at ${jobData.company}`);
    }
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
      <div style={{ padding: 48, textAlign: 'center' }} role="status" aria-live="polite">
        <p>Loading applications...</p>
      </div>
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
      <div className="jobsStats" role="region" aria-label="Application statistics">
        <div className="statItem">
          <span className="statValue" aria-label={`${totalApps} total applications`}>{totalApps}</span>
          <span className="statLabel">Total Applications</span>
        </div>
        <div className="statItem">
          <span className="statValue" aria-label={`${getStageCount('interview') + getStageCount('offer')} interviewing`}>
            {getStageCount('interview') + getStageCount('offer')}
          </span>
          <span className="statLabel">Interviewing</span>
        </div>
        <div className="statItem">
          <span className="statValue" aria-label={`${getStageCount('offer')} offers`}>
            {getStageCount('offer')}
          </span>
          <span className="statLabel">Offers</span>
        </div>
      </div>

      {/* Search and Filter Bar */}
      <div className="jobsToolbar" role="search" aria-label="Job applications search and filters">
        <div className="searchBox">
          <span className="searchIcon" aria-hidden="true">🔍</span>
          <input
            type="text"
            placeholder="Search by company, title, or notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="searchInput"
            id={searchId}
            aria-describedby="search-description"
          />
          <span id="search-description" className="srOnly">
            Filter job applications by company name, job title, or notes
          </span>
        </div>
        
        <div 
          className="filterButtons" 
          role="group" 
          aria-label="Filter by application stage"
          id={filterGroupId}
        >
          <button
            className={`filterBtn ${filterStage === 'all' ? 'active' : ''}`}
            onClick={() => setFilterStage('all')}
            aria-pressed={filterStage === 'all'}
          >
            All ({totalApps})
          </button>
          {STAGE_ORDER.slice(0, 5).map(stage => (
            <button
              key={stage}
              className={`filterBtn ${filterStage === stage ? 'active' : ''}`}
              onClick={() => setFilterStage(stage)}
              aria-pressed={filterStage === stage}
            >
              {STAGE_LABELS[stage]} ({getStageCount(stage)})
            </button>
          ))}
        </div>

        <button 
          className="addJobBtn" 
          onClick={() => setShowAddModal(true)}
          aria-label="Add new job application"
        >
          + Add Job
        </button>
      </div>

      {/* Kanban Board */}
      <div 
        className="kanbanBoard" 
        role="region" 
        aria-label="Job applications board - Drag and drop job applications between columns to change their status"
      >
        {STAGE_ORDER.map(stage => (
          <div
            key={stage}
            className={`kanbanColumn ${filterStage !== 'all' && filterStage !== stage ? 'dimmed' : ''}`}
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(stage)}
            role="listbox"
            aria-label={`${STAGE_LABELS[stage]} stage - ${getAppsByStage(stage).length} applications`}
            aria-readonly="true"
            tabIndex={0}
          >
            <div className="columnHeader">
              <span className="columnTitle">{STAGE_LABELS[stage]}</span>
              <span className="columnCount" aria-label={`${getAppsByStage(stage).length} items`}>
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
                  aria-label={`${app.title} at ${app.company}. ${app.notes ? `Notes: ${app.notes}. ` : ''}Drag to move to different stage.`}
                >
                  <div className="jobCardHeader">
                    <span className="jobCompany">{app.company}</span>
                    <button 
                      className="deleteBtn"
                      onClick={() => deleteApplication(app.id)}
                      title="Delete"
                      aria-label={`Delete ${app.title} application at ${app.company}`}
                    >
                      ×
                    </button>
                  </div>
                  <div className="jobTitle">{app.title}</div>
                  {app.notes && <div className="jobNotes">{app.notes}</div>}
                  <div className="jobMeta">
                    <span className="jobDate">
                      {app.applied_at 
                        ? `Applied: ${new Date(app.applied_at).toLocaleDateString()}`
                        : `Added: ${new Date(app.created_at).toLocaleDateString()}`}
                    </span>
                  </div>
                </div>
              ))}
              {getAppsByStage(stage).length === 0 && (
                <div className="emptyColumn" aria-live="polite">
                  {filterStage === 'all' ? `No ${STAGE_LABELS[stage].toLowerCase()} jobs` : 'No matching jobs'}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add Job Modal */}
      {showAddModal && (
        <AddJobModal 
          onClose={() => setShowAddModal(false)} 
          onSubmit={addJob}
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
          gap: 8px;
          padding: 8px 12px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border);
          border-radius: 8px;
          flex: 1;
          min-width: 250px;
        }

        .searchIcon {
          font-size: 0.9rem;
        }

        .searchInput {
          background: transparent;
          border: none;
          color: var(--text);
          flex: 1;
          outline: none;
          font-size: 0.9rem;
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
          padding: 6px 12px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--text-light);
          font-size: 0.8rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .filterBtn:hover {
          background: rgba(255, 255, 255, 0.06);
        }

        .filterBtn.active {
          background: rgba(99, 102, 241, 0.2);
          border-color: rgba(99, 102, 241, 0.5);
          color: #818cf8;
        }

        .addJobBtn {
          padding: 8px 16px;
          background: var(--primary);
          border: none;
          border-radius: 8px;
          color: white;
          font-weight: 600;
          cursor: pointer;
          transition: opacity 0.2s;
        }

        .addJobBtn:hover {
          opacity: 0.9;
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
}

function AddJobModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (data: JobFormData) => void }) {
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [jobUrl, setJobUrl] = useState('');
  const [notes, setNotes] = useState('');
  const modalTitleId = useId();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (company && title) {
      onSubmit({ company, title, job_url: jobUrl, notes });
    }
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
          <h3 id={modalTitleId}>Add New Job</h3>
          <button 
            className="closeBtn" 
            onClick={onClose}
            aria-label="Close dialog"
          >×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="formGroup">
            <label htmlFor="company-input">Company *</label>
            <input
              type="text"
              id="company-input"
              value={company}
              onChange={e => setCompany(e.target.value)}
              placeholder="e.g. Google"
              required
            />
          </div>
          <div className="formGroup">
            <label htmlFor="title-input">Job Title *</label>
            <input
              type="text"
              id="title-input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Senior Software Engineer"
              required
            />
          </div>
          <div className="formGroup">
            <label htmlFor="url-input">Job URL</label>
            <input
              type="url"
              id="url-input"
              value={jobUrl}
              onChange={e => setJobUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className="formGroup">
            <label htmlFor="notes-input">Notes</label>
            <textarea
              id="notes-input"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add any notes..."
              rows={3}
            />
          </div>
          <div className="modalActions">
            <button type="button" className="cancelBtn" onClick={onClose}>Cancel</button>
            <button type="submit" className="submitBtn">Add Job</button>
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
          width: 100%;
          max-width: 420px;
          padding: 20px;
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
        .formGroup textarea {
          width: 100%;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          font-size: 0.9rem;
        }

        .formGroup input:focus,
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

        .cancelBtn {
          padding: 8px 16px;
          background: transparent;
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text-light);
          cursor: pointer;
        }

        .cancelBtn:focus-visible,
        .submitBtn:focus-visible {
          outline: 2px solid var(--focus-ring);
          outline-offset: 2px;
        }

        .submitBtn {
          padding: 8px 16px;
          background: var(--primary);
          border: none;
          border-radius: 8px;
          color: white;
          font-weight: 600;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
