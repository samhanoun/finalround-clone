import { useTranslations } from 'next-intl';
import { ResumeIcon } from '@/components/icons';
import styles from './answerMoment.module.css';

/**
 * The moment the product exists for: the interviewer is still asking, and the
 * answer card has already arrived, written from the candidate's résumé.
 * `hero` adds the interviewer's video tile and plays the one entrance on the
 * landing page; `compact` is the quiet version beside the sign-in form.
 * Ice is the interviewer's voice and Ember is yours, as in the app.
 */
export function AnswerMoment({ variant }: { variant: 'hero' | 'compact' }) {
  const t = useTranslations('Landing.demo');
  return (
    <figure className={`${styles.moment} ${styles[variant]}`} aria-label={t('label')}>
      {variant === 'hero' ? (
        <div className={styles.tile} aria-hidden="true">
          <span className={styles.clock}>24:18</span>
          <span className={styles.avatar}>{t('initials')}</span>
          <span className={styles.nameTag}>
            <span className={styles.bars}>
              <i />
              <i />
              <i />
              <i />
            </span>
            {t('speaker')}
          </span>
        </div>
      ) : null}

      <div className={styles.card}>
        <div className={styles.track} aria-hidden="true">
          <span className={styles.voice} data-voice="them">
            {t('interviewer')}
          </span>
          <svg className={styles.trace} viewBox={`0 0 ${TRACE_WIDTH} 16`} preserveAspectRatio="none" focusable="false">
            <path className={styles.traceThem} d={THEM} pathLength={1} />
          </svg>
          <span className={styles.voice} data-voice="you">
            {t('you')}
          </span>
          <svg className={styles.trace} viewBox={`0 0 ${TRACE_WIDTH} 16`} preserveAspectRatio="none" focusable="false">
            <path className={styles.traceYou} d={YOU} />
          </svg>
        </div>

        <p className={styles.question}>{t('question')}</p>
        <p className={styles.lead}>{t('lead')}</p>
        <ul className={styles.points}>
          <li>{t('point1')}</li>
          <li>{t('point2')}</li>
          <li>{t('point3')}</li>
        </ul>
        <p className={styles.foot}>
          <span className={styles.source}>
            <ResumeIcon size={14} />
            {t('source')}
          </span>
          <span className={styles.timing}>{t('timing')}</span>
        </p>
      </div>
    </figure>
  );
}

const TRACE_WIDTH = 240;

/** A voice trace: flat while that voice is quiet, a zig-zag of uneven peaks while it speaks. */
function voiceTrace(spans: Array<[number, number]>, seed: number): string {
  const mid = 8;
  let d = `M0 ${mid}`;
  let x = 0;
  let step = 0;
  for (const [start, end] of spans) {
    if (start > x) d += ` H${start}`;
    x = start;
    let up = true;
    while (x + 3 <= end) {
      // Deterministic, so the server and the browser draw the same line.
      const noise = Math.abs(Math.sin((step + 1) * 12.9898 + seed * 78.233) * 43758.5453) % 1;
      const envelope = 0.35 + 0.65 * Math.abs(Math.sin(step * 0.45 + seed));
      const height = Math.max(1.2, 7 * envelope * (0.45 + 0.55 * noise));
      x += 3;
      d += ` L${x} ${(up ? mid - height : mid + height).toFixed(1)}`;
      up = !up;
      step += 1;
    }
    d += ` L${end} ${mid}`;
    x = end;
  }
  if (x < TRACE_WIDTH) d += ` H${TRACE_WIDTH}`;
  return d;
}

/** The interviewer: the last question, then this one, still being asked at the right edge. */
const THEM = voiceTrace(
  [
    [0, 42],
    [138, TRACE_WIDTH],
  ],
  1,
);
/** You: your previous answer, between the two questions. */
const YOU = voiceTrace([[50, 128]], 2);
