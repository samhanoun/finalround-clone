'use client';

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
  return (
    <section className="card" aria-label="Live transcript panel">
      <div className="cardInner stack" style={{ gap: 12 }}>
        <div className={styles.panelHeader}>
          <h2 className="cardTitle">Transcript</h2>
          <span className="small">{rows.length} {rows.length === 1 ? 'line' : 'lines'}</span>
        </div>
        {rows.length === 0 ? (
          <p className={styles.emptyState}>
            {isActive ? 'Waiting for transcript input…' : 'Start a session to capture transcript lines.'}
          </p>
        ) : null}
        <ol className={styles.feedList}>
          {rows.map((row) => (
            <li key={row.id} className={styles.feedCard}>
              <div className={styles.feedMeta}>
                <span className={`badge ${row.speaker === 'interviewer' ? 'badgeIce' : 'badgePro'}`}>
                  {row.speaker === 'interviewer' ? 'Interviewer' : 'You'}
                </span>
                <span className="small mono">{new Date(row.created_at).toLocaleTimeString()}</span>
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
  return (
    <section className="card" aria-label="Live suggestions panel">
      <div className="cardInner stack" style={{ gap: 12 }}>
        <div className={styles.panelHeader}>
          <h2 className="cardTitle">Answers</h2>
          <span className="small">{rows.length} saved</span>
        </div>
        {rows.length === 0 ? (
          <p className={styles.emptyState}>
            {isActive
              ? 'Answers are saved here once they finish streaming.'
              : 'Start a session; answers to interviewer questions are saved here.'}
          </p>
        ) : null}
        <ol className={styles.feedList}>
          {rows.map((row) => (
            <li key={row.id} className={styles.feedCard}>
              <div className={styles.feedMeta}>
                <span className="badge">{row.category.charAt(0).toUpperCase() + row.category.slice(1)}</span>
                <span className="small mono">{new Date(row.created_at).toLocaleTimeString()}</span>
              </div>
              {row.question ? (
                <p className={styles.feedQuestion}>{row.question}</p>
              ) : null}
              <div className={styles.feedText}>
                <AnswerBody text={row.text} />
              </div>
              {row.complexity ? (
                <p className="small" style={{ margin: 0 }}>
                  <strong>Complexity:</strong> {row.complexity}
                </p>
              ) : null}
              <Points id={row.id} title="Edge cases" items={row.edgeCases} />
              <Points id={row.id} title="Checklist" items={row.checklist} />
              <Points id={row.id} items={row.talkingPoints} />
              {row.followUp ? (
                <p className="small" style={{ margin: 0 }}>
                  <strong>Follow-up:</strong> {row.followUp}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
