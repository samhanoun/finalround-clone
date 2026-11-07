import styles from './InterviewerAvatar.module.css';

const MOUTH_BARS = [0, 1, 2, 3, 4];

/**
 * The practice interviewer: an abstract face whose mouth moves while the
 * question is read aloud, and whose eyes follow your answer while you speak.
 */
export function InterviewerAvatar({ state, label }: { state: 'speaking' | 'listening' | 'idle'; label: string }) {
  return (
    <div className={styles.avatar} data-state={state} role="img" aria-label={label}>
      <svg viewBox="0 0 96 96" className={styles.face} aria-hidden="true">
        <rect className={styles.head} x="10" y="8" width="76" height="80" rx="30" />
        <g className={styles.eyes}>
          <rect x="30" y="36" width="9" height="12" rx="4.5" />
          <rect x="57" y="36" width="9" height="12" rx="4.5" />
        </g>
        <g className={styles.mouth}>
          {MOUTH_BARS.map((bar) => (
            <rect key={bar} className={styles.bar} x={36 + bar * 5.5} y="60" width="3.2" height="8" rx="1.6" style={{ animationDelay: `${bar * 90}ms` }} />
          ))}
        </g>
      </svg>
    </div>
  );
}
