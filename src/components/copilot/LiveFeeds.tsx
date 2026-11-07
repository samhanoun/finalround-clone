'use client';

import { useEffect, useId, useRef } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import styles from './LiveFeeds.module.css';
import { AnswerBody } from './AnswerView';

export type TranscriptRow = { id: string; text: string; speaker: string; created_at: string };

export type SuggestionRow = {
  id: string;
  text: string;
  category: string;
  question: string;
  followUp: string;
  complexity: string;
  edgeCases: string[];
  checklist: string[];
  talkingPoints: string[];
  created_at: string;
};

export type FeedLayout = 'split' | 'transcript' | 'suggestions';

/** Keeps a growing list scrolled to its newest item, unless the reader scrolled up. */
function useStickToBottom<T extends HTMLElement>(count: number) {
  const ref = useRef<T | null>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    const onScroll = () => {
      atBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 32;
    };
    list.addEventListener('scroll', onScroll, { passive: true });
    return () => list.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const list = ref.current;
    if (list && atBottom.current) list.scrollTop = list.scrollHeight;
  }, [count]);

  return ref;
}

/** What was said, line by line, each marked with its speaker's voice colour. */
export function TranscriptFeed({ rows, isActive }: { rows: TranscriptRow[]; isActive: boolean }) {
  const t = useTranslations('LiveFeeds');
  const format = useFormatter();
  const listRef = useStickToBottom<HTMLOListElement>(rows.length);
  return (
    <section className={styles.feed} aria-label={t('transcriptLabel')}>
      <header className={styles.feedHeader}>
        <h3 className={styles.feedTitle}>{t('transcript')}</h3>
        <span className={styles.count}>{t('lines', { count: rows.length })}</span>
      </header>
      {rows.length === 0 ? <p className={styles.empty}>{isActive ? t('transcriptWaiting') : t('transcriptIdle')}</p> : null}
      <ol ref={listRef} className={styles.list}>
        {rows.map((row) => (
          <li key={row.id} className={styles.line} data-voice={row.speaker === 'interviewer' ? 'interviewer' : 'you'}>
            <div className={styles.meta}>
              <span className={styles.speaker}>{row.speaker === 'interviewer' ? t('interviewer') : t('you')}</span>
              <time className={styles.time} dateTime={row.created_at}>
                {format.dateTime(new Date(row.created_at), { timeStyle: 'medium' })}
              </time>
            </div>
            <p className={styles.text}>{row.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Points({ id, title, items }: { id: string; title?: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.extra}>
      {title ? <p className={styles.extraTitle}>{title}</p> : null}
      <ul className={styles.points}>
        {items.map((item, index) => (
          <li key={`${id}-${title ?? 'point'}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** Answers saved this session (newest last), including ones from before Step 4's free-text format. */
export function SuggestionFeed({ rows, isActive }: { rows: SuggestionRow[]; isActive: boolean }) {
  const t = useTranslations('LiveFeeds');
  const tAnswer = useTranslations('Answer');
  const format = useFormatter();
  const listRef = useStickToBottom<HTMLOListElement>(rows.length);
  return (
    <section className={styles.feed} aria-label={t('answersLabel')}>
      <header className={styles.feedHeader}>
        <h3 className={styles.feedTitle}>{t('answers')}</h3>
        <span className={styles.count}>{t('saved', { count: rows.length })}</span>
      </header>
      {rows.length === 0 ? <p className={styles.empty}>{isActive ? t('answersWaiting') : t('answersIdle')}</p> : null}
      <ol ref={listRef} className={styles.list}>
        {rows.map((row) => (
          <li key={row.id} className={styles.entry}>
            <div className={styles.meta}>
              <span className={styles.category}>
                {tAnswer.has(`category.${row.category}`)
                  ? tAnswer(`category.${row.category}`)
                  : row.category.charAt(0).toUpperCase() + row.category.slice(1)}
              </span>
              <time className={styles.time} dateTime={row.created_at}>
                {format.dateTime(new Date(row.created_at), { timeStyle: 'medium' })}
              </time>
            </div>
            {row.question ? <p className={styles.question}>{row.question}</p> : null}
            <div className={styles.answer}>
              <AnswerBody text={row.text} />
            </div>
            {row.complexity ? (
              <p className={styles.note}>
                <span className={styles.noteLabel}>{t('complexity')}</span> {row.complexity}
              </p>
            ) : null}
            <Points id={row.id} title={t('edgeCases')} items={row.edgeCases} />
            <Points id={row.id} title={t('checklist')} items={row.checklist} />
            <Points id={row.id} items={row.talkingPoints} />
            {row.followUp ? (
              <p className={styles.note}>
                <span className={styles.noteLabel}>{t('followUp')}</span> {row.followUp}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The transcript and the saved answers, side by side or one at a time
 * (quiet underline tabs). During a session, or after one with saved lines.
 */
export function FeedsSection({
  title,
  layout,
  onLayout,
  transcript,
  suggestions,
  isActive,
}: {
  title: string;
  layout: FeedLayout;
  onLayout: (layout: FeedLayout) => void;
  transcript: TranscriptRow[];
  suggestions: SuggestionRow[];
  isActive: boolean;
}) {
  const t = useTranslations('Copilot');
  const titleId = useId();
  const options: Array<[FeedLayout, string]> = [
    ['split', t('layout.split')],
    ['transcript', t('layout.transcript')],
    ['suggestions', t('layout.answers')],
  ];
  return (
    <section className={`card ${styles.section}`} aria-labelledby={titleId}>
      <header className={styles.sectionHeader}>
        <h2 id={titleId} className={styles.sectionTitle}>
          {title}
        </h2>
        <div className={styles.tabs} role="toolbar" aria-label={t('layout.options')}>
          {options.map(([value, label]) => (
            <button key={value} type="button" className={styles.tab} aria-pressed={layout === value} onClick={() => onLayout(value)}>
              {label}
            </button>
          ))}
        </div>
      </header>
      <div className={styles.grid} data-layout={layout}>
        {layout !== 'suggestions' ? <TranscriptFeed rows={transcript} isActive={isActive} /> : null}
        {layout !== 'transcript' ? <SuggestionFeed rows={suggestions} isActive={isActive} /> : null}
      </div>
    </section>
  );
}
