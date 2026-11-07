'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { createClient } from '@/lib/supabase/browser';
import styles from './SessionSetup.module.css';
import { detectMeetingPlatform, meetingUrl, PLATFORM_LABEL } from '@/lib/meetingSettings';
import {
  CODING_LANGUAGE_NAME,
  CODING_LANGUAGES,
  isCodingLanguage,
  isSpokenLanguage,
  SPOKEN_LANGUAGES,
  type CodingLanguage,
  type SpokenLanguage,
} from '@/lib/copilot/sessionOptions';

export type CopilotMode = 'general' | 'coding' | 'phone' | 'video';

export type SessionSetupValue = {
  mode: CopilotMode;
  title: string;
  company: string;
  role: string;
  resumeDocumentId: string;
  jobDescription: string;
  /** Coding sessions: hints and approach only, no complete solutions. */
  noFullCode: boolean;
  /** Settings → Meeting apps → "Ask for the meeting link": the interview's Meet, Zoom or Teams link. */
  meetingUrl: string;
  /** A saved goal (Goals page): its materials, playbook and memories come along. */
  goalId: string;
  /** This session only; empty = the user's settings. */
  answerModel: string;
  language: SpokenLanguage | '';
  codingLanguage: CodingLanguage | '';
  /** Phone / in-person: one microphone for both people. */
  singleMic: boolean;
  /** A playbook for this session; empty = the goal's (or none). */
  playbookId: string;
};

export const EMPTY_SETUP: SessionSetupValue = {
  mode: 'general',
  title: '',
  company: '',
  role: '',
  resumeDocumentId: '',
  jobDescription: '',
  noFullCode: false,
  meetingUrl: '',
  goalId: '',
  answerModel: '',
  language: '',
  codingLanguage: '',
  singleMic: false,
  playbookId: '',
};

const STORAGE_KEY = 'apex.sessionSetup.v1';
const MODES: CopilotMode[] = ['general', 'coding', 'phone', 'video'];

type ResumeOption = { id: string; filename: string | null; created_at: string };
type GoalOption = {
  id: string;
  name: string;
  company: string | null;
  role: string | null;
  round: string;
  resume_document_id: string | null;
  job_description: string | null;
};
type ModelOption = { id: string; label: string };
type PlaybookOption = { id: string; name: string };

/** The last setup this browser used, so a second interview for the same job starts fast. */
export function loadSavedSetup(): SessionSetupValue {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_SETUP;
    const saved = JSON.parse(raw) as Partial<SessionSetupValue>;
    const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');
    return {
      mode: MODES.includes(saved.mode as CopilotMode) ? (saved.mode as CopilotMode) : 'general',
      title: text(saved.title, 200),
      company: text(saved.company, 200),
      role: text(saved.role, 200),
      resumeDocumentId: text(saved.resumeDocumentId, 64),
      jobDescription: text(saved.jobDescription, 20_000),
      noFullCode: saved.noFullCode === true,
      meetingUrl: text(saved.meetingUrl, 2000),
      goalId: text(saved.goalId, 64),
      answerModel: text(saved.answerModel, 100),
      language: isSpokenLanguage(saved.language) ? saved.language : '',
      codingLanguage: isCodingLanguage(saved.codingLanguage) ? saved.codingLanguage : '',
      singleMic: saved.singleMic === true,
      playbookId: text(saved.playbookId, 64),
    };
  } catch {
    return EMPTY_SETUP;
  }
}

export function saveSetup(value: SessionSetupValue): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode): nothing to remember
  }
}

/** How an untitled session is named, in the user's language (SessionSetup.titleAt / titleDefault). */
export type StartTitles = { at: (role: string, company: string) => string; fallback: (mode: CopilotMode) => string };

/** The start route's body: only filled fields, with a sensible default title. */
export function setupStartBody(value: SessionSetupValue, titles: StartTitles) {
  const company = value.company.trim();
  const role = value.role.trim();
  const target = role && company ? titles.at(role, company) : role || company;
  const optional = {
    resumeDocumentId: value.resumeDocumentId || undefined,
    company: company || undefined,
    role: role || undefined,
    jobDescription: value.jobDescription.trim() || undefined,
    goalId: value.goalId || undefined,
    answerModel: value.answerModel || undefined,
    language: value.language || undefined,
    codingLanguage: value.codingLanguage || undefined,
    singleMic: value.singleMic || undefined,
    playbookId: value.playbookId || undefined,
  };
  return {
    title: value.title.trim() || target || titles.fallback(value.mode),
    metadata: {
      mode: value.mode,
      beta: true,
      noFullCodeMode: value.mode === 'coding' && value.noFullCode,
    },
    ...Object.fromEntries(Object.entries(optional).filter(([, field]) => field !== undefined)),
  };
}

/**
 * The pre-session setup step: a goal (or the interview by hand), the résumé,
 * the job, and this session's choices. All optional; the server turns it into
 * the context pack.
 */
export function SessionSetup({
  value,
  onChange,
  onStart,
  starting,
  askForLink = false,
  autoStartListening = false,
  initialGoalId = null,
}: {
  value: SessionSetupValue;
  onChange: (next: SessionSetupValue) => void;
  onStart: () => void;
  starting: boolean;
  /** Settings → Meeting apps. */
  askForLink?: boolean;
  autoStartListening?: boolean;
  /** /copilot/live?goal=… from the Goals page. */
  initialGoalId?: string | null;
}) {
  const t = useTranslations('SessionSetup');
  const format = useFormatter();
  const [resumes, setResumes] = useState<ResumeOption[] | null>(null);
  const [goals, setGoals] = useState<GoalOption[] | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [playbooks, setPlaybooks] = useState<PlaybookOption[]>([]);
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    void (async () => {
      const [resumeRows, goalRows, modelRes, playbookRows] = await Promise.all([
        supabase
          .from('resume_documents')
          .select('id, filename, created_at')
          .not('parsed_text', 'is', null)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('goals')
          .select('id, name, company, role, round, resume_document_id, job_description')
          .eq('archived', false)
          .order('updated_at', { ascending: false })
          .limit(50),
        fetch('/api/settings/llm').catch(() => null),
        supabase.from('playbooks').select('id, name').order('updated_at', { ascending: false }).limit(50),
      ]);
      if (cancelled) return;
      const list = (resumeRows.data as ResumeOption[] | null) ?? [];
      const goalList = (goalRows.data as GoalOption[] | null) ?? [];
      setResumes(list);
      setGoals(goalList);
      const playbookList = (playbookRows.data as PlaybookOption[] | null) ?? [];
      setPlaybooks(playbookList);
      const modelJson = modelRes?.ok ? await modelRes.json().catch(() => null) : null;
      if (!cancelled && modelJson?.options) setModels(modelJson.options as ModelOption[]);

      const { value: current, onChange: update } = latest.current;
      let next = current;
      // A remembered résumé or goal that has since been deleted shouldn't be sent.
      if (next.resumeDocumentId && !list.some((resume) => resume.id === next.resumeDocumentId)) next = { ...next, resumeDocumentId: '' };
      if (next.goalId && !goalList.some((goal) => goal.id === next.goalId)) next = { ...next, goalId: '' };
      if (next.playbookId && !playbookList.some((playbook) => playbook.id === next.playbookId)) next = { ...next, playbookId: '' };
      // Opened from a goal: use it.
      const fromUrl = initialGoalId ? goalList.find((goal) => goal.id === initialGoalId) : undefined;
      if (fromUrl) next = withGoal(next, fromUrl);
      if (next !== current) update(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [initialGoalId]);

  const set = (patch: Partial<SessionSetupValue>) => onChange({ ...value, ...patch });
  const linkPlatform = detectMeetingPlatform(value.meetingUrl);
  const linkIsValid = meetingUrl(value.meetingUrl) !== null;
  const titlePlaceholder =
    [value.role.trim(), value.company.trim() && t('at', { company: value.company.trim() })].filter(Boolean).join(' ') ||
    t('titlePlaceholder');

  function pickGoal(goalId: string) {
    const goal = goals?.find((item) => item.id === goalId);
    onChange(goal ? withGoal(value, goal) : { ...value, goalId: '' });
  }

  return (
    <section className="card" aria-label={t('label')}>
      <div className="cardInner stack" style={{ gap: 16 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h2 className="cardTitle">{t('title')}</h2>
          <p className="small" style={{ margin: 0 }}>
            {t('intro')}
          </p>
        </div>

        <label className="label">
          {t('goal')}
          <select className="select" value={value.goalId} onChange={(e) => pickGoal(e.target.value)} disabled={starting || goals === null}>
            <option value="">{goals === null ? t('loading') : t('noGoal')}</option>
            {(goals ?? []).map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.name}
              </option>
            ))}
          </select>
          <span className="help">
            {value.goalId ? (
              t('goalHelp')
            ) : (
              <>
                {t('noGoalHelp')} <Link href="/goals">{t('manageGoals')}</Link>
              </>
            )}
          </span>
        </label>

        <ol className={styles.steps}>
          <li className={styles.step}>
            <h3 className={styles.stepTitle}>{t('stepInterview')}</h3>
            <div className="grid2">
              <label className="label">
                {t('mode')}
                <select
                  className="select"
                  value={value.mode}
                  onChange={(e) => set({ mode: e.target.value as CopilotMode })}
                  disabled={starting}
                >
                  {MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {t(`modes.${mode}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="label">
                {t('company')}
                <input
                  className="input"
                  value={value.company}
                  onChange={(e) => set({ company: e.target.value })}
                  placeholder={t('companyPlaceholder')}
                  maxLength={200}
                  disabled={starting}
                />
              </label>
              <label className="label">
                {t('role')}
                <input
                  className="input"
                  value={value.role}
                  onChange={(e) => set({ role: e.target.value })}
                  placeholder={t('rolePlaceholder')}
                  maxLength={200}
                  disabled={starting}
                />
              </label>
              <label className="label">
                {t('sessionTitle')}
                <input
                  className="input"
                  value={value.title}
                  onChange={(e) => set({ title: e.target.value })}
                  placeholder={titlePlaceholder}
                  maxLength={200}
                  disabled={starting}
                />
              </label>
            </div>
            {askForLink ? (
              <label className="label">
                {t('meetingLink')}
                <input
                  className="input"
                  type="url"
                  inputMode="url"
                  value={value.meetingUrl}
                  onChange={(e) => set({ meetingUrl: e.target.value })}
                  placeholder={t('meetingLinkPlaceholder')}
                  maxLength={2000}
                  disabled={starting}
                />
                <span className="help">
                  {!value.meetingUrl.trim()
                    ? t('meetingLinkHelp')
                    : linkPlatform
                      ? t('meetingLinkFound', { app: PLATFORM_LABEL[linkPlatform] })
                      : linkIsValid
                        ? t('meetingLinkOther')
                        : t('meetingLinkInvalid')}
                </span>
              </label>
            ) : null}
            <label className={styles.checkbox}>
              <input type="checkbox" checked={value.singleMic} onChange={(e) => set({ singleMic: e.target.checked })} disabled={starting} />
              <span>
                <strong>{t('singleMic')}</strong> {t('singleMicHelp')}
              </span>
            </label>
            {value.mode === 'coding' ? (
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={value.noFullCode}
                  onChange={(e) => set({ noFullCode: e.target.checked })}
                  disabled={starting}
                />
                <span>
                  <strong>{t('hintsOnly')}</strong> {t('hintsOnlyHelp')}
                </span>
              </label>
            ) : null}
          </li>

          <li className={styles.step}>
            <h3 className={styles.stepTitle}>{t('stepResume')}</h3>
            <label className="label">
              {t('resume')}
              <select
                className="select"
                value={value.resumeDocumentId}
                onChange={(e) => set({ resumeDocumentId: e.target.value })}
                disabled={starting || resumes === null}
              >
                <option value="">{resumes === null ? t('loading') : t('none')}</option>
                {(resumes ?? []).map((resume) => (
                  <option key={resume.id} value={resume.id}>
                    {resume.filename ?? t('untitled')} · {format.dateTime(new Date(resume.created_at), { dateStyle: 'medium' })}
                  </option>
                ))}
              </select>
            </label>
            {resumes !== null && resumes.length === 0 ? (
              <p className="small" style={{ margin: 0 }}>
                {t('noResumes')} <Link href="/resume">{t('uploadResume')}</Link>
              </p>
            ) : null}
          </li>

          <li className={styles.step}>
            <h3 className={styles.stepTitle}>{t('stepJob')}</h3>
            <label className="label">
              {t('jobDescription')}
              <textarea
                className="textarea"
                rows={5}
                value={value.jobDescription}
                onChange={(e) => set({ jobDescription: e.target.value })}
                placeholder={t('jobDescriptionPlaceholder')}
                maxLength={20_000}
                disabled={starting}
              />
            </label>
          </li>

          <li className={styles.step}>
            <h3 className={styles.stepTitle}>{t('stepChoices')}</h3>
            <div className="grid2">
              <label className="label">
                {t('answerModel')}
                <select className="select" value={value.answerModel} onChange={(e) => set({ answerModel: e.target.value })} disabled={starting}>
                  <option value="">{t('yourSetting')}</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="label">
                {t('spokenLanguage')}
                <select
                  className="select"
                  value={value.language}
                  onChange={(e) => set({ language: e.target.value as SpokenLanguage | '' })}
                  disabled={starting}
                >
                  <option value="">{t('serverDefault')}</option>
                  {SPOKEN_LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {t(`spoken.${language}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="label">
                {t('codingLanguage')}
                <select
                  className="select"
                  value={value.codingLanguage}
                  onChange={(e) => set({ codingLanguage: e.target.value as CodingLanguage | '' })}
                  disabled={starting}
                >
                  <option value="">{t('anyLanguage')}</option>
                  {CODING_LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {CODING_LANGUAGE_NAME[language]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="label">
                {t('playbook')}
                <select className="select" value={value.playbookId} onChange={(e) => set({ playbookId: e.target.value })} disabled={starting}>
                  <option value="">{value.goalId ? t('goalPlaybook') : t('none')}</option>
                  {playbooks.map((playbook) => (
                    <option key={playbook.id} value={playbook.id}>
                      {playbook.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </li>
        </ol>

        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="button buttonPrimary" type="button" onClick={onStart} disabled={starting}>
            {starting ? t('starting') : t('start')}
          </button>
          <span className="small">{autoStartListening ? t('nextAuto') : t('next')}</span>
        </div>
      </div>
    </section>
  );
}

/** The setup filled from a goal (the server reads the goal again; these fields stay editable). */
function withGoal(value: SessionSetupValue, goal: GoalOption): SessionSetupValue {
  return {
    ...value,
    goalId: goal.id,
    company: goal.company ?? '',
    role: goal.role ?? '',
    resumeDocumentId: goal.resume_document_id ?? '',
    jobDescription: goal.job_description ?? '',
    title: '',
    mode: goal.round === 'technical' || goal.round === 'system_design' ? 'coding' : goal.round === 'screen' ? 'phone' : value.mode,
  };
}
