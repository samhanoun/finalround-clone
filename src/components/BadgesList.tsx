'use client';

import { useState, useEffect, type ComponentType } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ShareMenu } from './SocialShareButton';
import { ClockIcon, CloseIcon, JobsIcon, LiveIcon, PracticeIcon, ResumeIcon, UsersIcon, type IconProps } from './icons';
import styles from './BadgesList.module.css';

type Badge = {
  id: string;
  badge_type: string;
  title: string;
  description: string | null;
  icon: string | null;
  awarded_at: string;
  metadata: Record<string, unknown>;
};

/** Line glyphs in the icons.tsx style for the badges it has no icon for. */
function Glyph({ size = 18, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const StarIcon = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z" />
  </Glyph>
);

const TrophyIcon = ({ size }: IconProps) => (
  <Glyph size={size}>
    <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5.5a3 3 0 0 0 3 4M16 6h2.5a3 3 0 0 1-3 4M12 13v4M8.5 20.5h7M10 17h4" />
  </Glyph>
);

const ShareIcon = ({ size }: IconProps) => (
  <Glyph size={size}>
    <circle cx="17.5" cy="5.5" r="2.5" />
    <circle cx="6.5" cy="12" r="2.5" />
    <circle cx="17.5" cy="18.5" r="2.5" />
    <path d="M8.7 10.8l6.6-4M8.7 13.2l6.6 4" />
  </Glyph>
);

const BADGE_ICONS: Record<string, ComponentType<IconProps>> = {
  first_interview: PracticeIcon,
  five_sessions: LiveIcon,
  ten_sessions: LiveIcon,
  first_offer: StarIcon,
  streak_week: ClockIcon,
  streak_month: ClockIcon,
  resume_optimized: ResumeIcon,
  job_applied: JobsIcon,
  referral_signup: UsersIcon,
  referral_conversion: TrophyIcon,
  share: ShareIcon,
};

export function BadgesList() {
  const t = useTranslations('Badges');
  const format = useFormatter();
  // Badges are stored with English names; known kinds are shown in the app's language.
  const titleOf = (badge: Badge) => (t.has(`kinds.${badge.badge_type}.title`) ? t(`kinds.${badge.badge_type}.title`) : badge.title);
  const descriptionOf = (badge: Badge) =>
    t.has(`kinds.${badge.badge_type}.description`) ? t(`kinds.${badge.badge_type}.description`) : badge.description;
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed load says so instead of claiming there are no badges.
  const [failed, setFailed] = useState(false);
  const [selectedBadge, setSelectedBadge] = useState<Badge | null>(null);

  useEffect(() => {
    const fetchBadges = async () => {
      try {
        const response = await fetch('/api/badges');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        setBadges(data.badges || []);
      } catch (error) {
        console.error('Failed to fetch badges:', error);
        setFailed(true);
      } finally {
        setLoading(false);
      }
    };

    fetchBadges();
  }, []);

  return (
    <section className="card" aria-labelledby="badges-heading">
      <div className={`cardInner ${styles.inner}`}>
        <div className={styles.head}>
          <h2 className="cardTitle" id="badges-heading">
            {t('title')}
          </h2>
          {badges.length ? <span className={styles.count}>{format.number(badges.length)}</span> : null}
        </div>

        {loading ? (
          <p className={styles.note}>{t('loading')}</p>
        ) : failed ? (
          <p className={styles.note} role="alert">
            {t('loadFailed')}
          </p>
        ) : !badges.length ? (
          <p className={styles.note}>{t('empty')}</p>
        ) : (
          <>
            <ul className={styles.grid}>
              {badges.map((badge) => {
                const Icon = BADGE_ICONS[badge.badge_type] ?? ShareIcon;
                return (
                  <li key={badge.id}>
                    <button
                      type="button"
                      className={styles.badge}
                      onClick={() => setSelectedBadge(selectedBadge?.id === badge.id ? null : badge)}
                      aria-pressed={selectedBadge?.id === badge.id}
                      aria-label={t('badgeLabel', { badge: titleOf(badge) })}
                    >
                      <span className={styles.badgeIcon}>
                        <Icon size={18} />
                      </span>
                      <span className={styles.badgeName}>{titleOf(badge)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {selectedBadge && (
              <div className={styles.detail}>
                <div className={styles.detailHead}>
                  <h3 className={styles.detailTitle}>{titleOf(selectedBadge)}</h3>
                  <button type="button" className="iconButton" onClick={() => setSelectedBadge(null)} aria-label={t('close')}>
                    <CloseIcon size={16} />
                  </button>
                </div>
                {descriptionOf(selectedBadge) ? <p className={styles.detailText}>{descriptionOf(selectedBadge)}</p> : null}
                <p className={styles.awarded}>
                  {t('awarded', { date: format.dateTime(new Date(selectedBadge.awarded_at), { dateStyle: 'medium' }) })}
                </p>
                <div className={styles.share}>
                  <span className={styles.shareLabel}>{t('share')}</span>
                  {/* The menu records each share once, as a badge share. */}
                  <ShareMenu
                    shareType="badge"
                    contentId={selectedBadge.id}
                    content={{
                      title: t('shareTitle', { badge: titleOf(selectedBadge) }),
                      summary: descriptionOf(selectedBadge) || t('shareSummary'),
                    }}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
