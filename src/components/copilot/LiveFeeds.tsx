'use client';

import { useFormatter, useTranslations } from 'next-intl';
import styles from '../LiveCopilotClient.module.css';
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

export function TranscriptFeed({ rows, isActive }: { rows: TranscriptRow[]; isActive: boolean }) {
  const t = useTranslations('LiveFeeds');
  const format = useFormatter();
  return (
    <section className="card" aria-label={t('transcriptLabel')}>
      <div className="cardInner stack" style={{ gap: 12 }}>
        <div className={styles.panelHeader}>
          <h2 className="cardTitle">{t('transcript')}</h2>
          <span className="small">{t('lines', { count: rows.length })}</span>
        </div>
        {rows.length === 0 ? <p className={styles.emptyState}>{isActive ? t('transcriptWaiting') : t('transcriptIdle')}</p> : null}
        <ol className={styles.feedList}>
          {rows.map((row) => (
            <li key={row.id} className={styles.feedCard}>
              <div className={styles.feedMeta}>
                <span className={`badge ${row.speaker === 'interviewer' ? 'badgeIce' : 'badgePro'}`}>
                  {row.speaker === 'interviewer' ? t('interviewer') : t('you')}
                </span>
                <span className="small mono">{format.dateTime(new Date(row.created_at), { timeStyle: 'medium' })}</span>
              </div>
              <p className={styles.feedText}>{row.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Points({ id, title, items }: { id: string; title?: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      {title ? (
        <p className="small" style={{ margin: '0 0 4px' }}>
          <strong>{title}</strong>
        </p>
      ) : null}
      <ul className={styles.pointsList}>
        {items.map((item, index) => (
          <li key={`${id}-${title ?? 'point'}-${index}`} className="small">
            {item}
          </li>
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
  return (
    <section className="card" aria-label={t('answersLabel')}>
      <div className="cardInner stack" style={{ gap: 12 }}>
        <div className={styles.panelHeader}>
          <h2 className="cardTitle">{t('answers')}</h2>
          <span className="small">{t('saved', { count: rows.length })}</span>
        </div>
        {rows.length === 0 ? <p className={styles.emptyState}>{isActive ? t('answersWaiting') : t('answersIdle')}</p> : null}
        <ol className={styles.feedList}>
          {rows.map((row) => (
            <li key={row.id} className={styles.feedCard}>
              <div className={styles.feedMeta}>
                <span className="badge">
                  {tAnswer.has(`category.${row.category}`)
                    ? tAnswer(`category.${row.category}`)
                    : row.category.charAt(0).toUpperCase() + row.category.slice(1)}
                </span>
                <span className="small mono">{format.dateTime(new Date(row.created_at), { timeStyle: 'medium' })}</span>
              </div>
              {row.question ? <p className={styles.feedQuestion}>{row.question}</p> : null}
              <div className={styles.feedText}>
                <AnswerBody text={row.text} />
              </div>
              {row.complexity ? (
                <p className="small" style={{ margin: 0 }}>
                  <strong>{t('complexity')}</strong> {row.complexity}
                </p>
              ) : null}
              <Points id={row.id} title={t('edgeCases')} items={row.edgeCases} />
              <Points id={row.id} title={t('checklist')} items={row.checklist} />
              <Points id={row.id} items={row.talkingPoints} />
              {row.followUp ? (
                <p className="small" style={{ margin: 0 }}>
                  <strong>{t('followUp')}</strong> {row.followUp}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
