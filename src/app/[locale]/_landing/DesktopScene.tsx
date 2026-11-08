import { useTranslations } from 'next-intl';
import { ApexMark } from '@/components/ApexMark';
import styles from './desktopScene.module.css';

/**
 * The Windows app, wide: a desktop meeting app with Apex Round's small answer
 * window pinned over its corner. One picture, so it reads as an image.
 */
export function DesktopScene() {
  const t = useTranslations('Landing');
  return (
    <figure className={styles.scene} role="img" aria-label={t('desktopDemo.label')}>
      <div className={styles.meeting}>
        <div className={styles.titleBar}>
          <span className={styles.title}>{t('desktopDemo.window')}</span>
          <span className={styles.controls}>
            <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
              <path d="M1.5 5h7" />
            </svg>
            <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
              <rect x="1.5" y="1.5" width="7" height="7" rx="1" />
            </svg>
            <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
              <path d="M2 2l6 6M8 2l-6 6" />
            </svg>
          </span>
        </div>
        <div className={styles.stage}>
          <div className={styles.person} data-speaking="">
            <span className={styles.initials}>{t('demo.initials')}</span>
            <span className={styles.name}>{t('demo.speaker')}</span>
          </div>
          <div className={styles.person}>
            <span className={styles.initials}>
              <PersonIcon />
            </span>
            <span className={styles.name}>{t('demo.you')}</span>
          </div>
        </div>
        <div className={styles.callBar}>
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>

      <div className={styles.answers}>
        <div className={styles.answersBar}>
          <ApexMark size={16} />
          <span className={styles.pinned}>
            <PinIcon />
            {t('desktopDemo.pinned')}
          </span>
        </div>
        <div className={styles.answersBody}>
          <p className={styles.question}>{t('demo.question')}</p>
          <p className={styles.lead}>{t('demo.lead')}</p>
          <p className={styles.point}>{t('demo.point1')}</p>
        </div>
      </div>

      <div className={styles.taskbar} aria-hidden="true">
        <i />
        <i />
        <ApexMark size={20} />
        <i />
        <i />
      </div>
    </figure>
  );
}

/** Your own tile: a head and shoulders, in the app's line style. */
function PersonIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}

/** Always on top: a pushpin, drawn in the same line style as the app's icons. */
function PinIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 3.5h6M10 3.5l-.6 6.2L6.5 13v1.5h11V13l-2.9-3.3L14 3.5M12 14.5V21" />
    </svg>
  );
}
