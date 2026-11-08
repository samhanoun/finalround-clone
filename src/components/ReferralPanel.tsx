'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { CopyIcon } from './icons';
import styles from './ReferralPanel.module.css';

/** Referral links open the sign-up form. */
function referralLink(code: string): string {
  return `${window.location.origin}/auth?mode=signup&ref=${encodeURIComponent(code)}`;
}

const STATUSES = ['pending', 'signed_up', 'converted', 'expired'];

type Referral = {
  id: string;
  referrer_id: string;
  referee_id: string | null;
  referral_code: string;
  status: 'pending' | 'signed_up' | 'converted' | 'expired';
  source: string | null;
  utm_campaign: string | null;
  utm_medium: string | null;
  utm_source: string | null;
  clicked_at: string;
  signed_up_at: string | null;
  converted_at: string | null;
  created_at: string;
};

type ReferralCode = {
  id: string;
  user_id: string;
  code: string;
  referral_count: number;
  conversion_count: number;
  created_at: string;
};

export function ReferralPanel() {
  const t = useTranslations('Referrals');
  const format = useFormatter();
  const [referralCode, setReferralCode] = useState<ReferralCode | null>(null);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The share itself opens on the other site; this says when recording it here failed.
  const [shareNotRecorded, setShareNotRecorded] = useState(false);

  useEffect(() => {
    const fetchReferralData = async () => {
      try {
        const response = await fetch('/api/referrals');
        const data = await response.json();

        if (data.error) {
          setError(t('loadFailed'));
        } else {
          setReferralCode(data.referral_code);
          setReferrals(data.referrals || []);
        }
      } catch (err) {
        console.error('Failed to fetch referral data:', err);
        setError(t('loadFailed'));
      } finally {
        setLoading(false);
      }
    };

    fetchReferralData();
  }, [t]);

  // The link field: when the browser won't let us copy, its text is selected so it can be copied by hand.
  const linkField = useRef<HTMLInputElement>(null);

  const copy = useCallback((text: string, which: 'link' | 'code') => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(which);
        setTimeout(() => setCopied(null), 2000);
      })
      .catch(() => {
        linkField.current?.focus();
        linkField.current?.select();
      });
  }, []);

  const copyReferralLink = useCallback(() => {
    if (referralCode) copy(referralLink(referralCode.code), 'link');
  }, [referralCode, copy]);

  const copyCode = useCallback(() => {
    if (referralCode) copy(referralCode.code, 'code');
  }, [referralCode, copy]);

  /** Shares on LinkedIn and X are recorded; the link itself opens the site (or the mail app). */
  const recordShare = useCallback(async (platform: 'linkedin' | 'twitter') => {
    if (!referralCode) return;
    setShareNotRecorded(false);
    try {
      const res = await fetch('/api/social/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          share_type: 'referral',
          platform,
          content_id: referralCode.id,
          content_title: 'Referral link shared',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (error) {
      console.error('Failed to record share:', error);
      setShareNotRecorded(true);
    }
  }, [referralCode]);

  const heading = (
    <div className={styles.head}>
      <h2 className="cardTitle" id="referrals-heading">
        {t('title')}
      </h2>
      <p className="cardDesc">{t('desc')}</p>
    </div>
  );

  if (loading || error) {
    return (
      <section className="card" aria-labelledby="referrals-heading">
        <div className={`cardInner ${styles.inner}`}>
          {heading}
          {error ? (
            <p className={styles.note} role="alert">
              {error}
            </p>
          ) : (
            <p className={styles.note}>{t('loading')}</p>
          )}
        </div>
      </section>
    );
  }

  const referralUrl = referralCode ? referralLink(referralCode.code) : '';
  const encodedUrl = encodeURIComponent(referralUrl);
  const encodedText = encodeURIComponent(t('shareText', { code: referralCode?.code ?? '' }));
  const shareLinks = {
    linkedin: `https://www.linkedin.com/shareArticle?mini=true&url=${encodedUrl}&title=${encodedText}`,
    twitter: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
    email: `mailto:?subject=${encodeURIComponent(t('emailSubject'))}&body=${encodedText}%0A%0A${encodedUrl}`,
  };

  return (
    <section className="card" aria-labelledby="referrals-heading">
      <div className={`cardInner ${styles.inner}`}>
        {heading}

        <div className={styles.linkRow}>
          <input ref={linkField} className={`input ${styles.link}`} type="text" readOnly value={referralUrl} aria-label={t('link')} />
          <button type="button" className="button" onClick={copyReferralLink}>
            <CopyIcon size={16} className={styles.buttonIcon} />
            {copied === 'link' ? t('copied') : t('copyLink')}
          </button>
        </div>

        <div className={styles.meta}>
          <span className={styles.codeLine}>
            {t.rich('code', { code: referralCode?.code ?? '', value: (chunks) => <code className={styles.code}>{chunks}</code> })}
          </span>
          <button type="button" className="button buttonGhost buttonSmall" onClick={copyCode} aria-label={t('copyCodeLabel')}>
            {copied === 'code' ? t('copied') : t('copyCode')}
          </button>
        </div>

        <div className={styles.share}>
          <span className={styles.shareLabel}>{t('shareOn')}</span>
          <a
            className="button buttonSmall"
            href={shareLinks.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => void recordShare('linkedin')}
          >
            {t('linkedin')}
          </a>
          <a
            className="button buttonSmall"
            href={shareLinks.twitter}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => void recordShare('twitter')}
            aria-label={t('shareOnX')}
          >
            X
          </a>
          <a className="button buttonSmall" href={shareLinks.email} aria-label={t('shareByEmail')}>
            {t('email')}
          </a>
        </div>
        {shareNotRecorded ? (
          <p className={styles.note} role="status">
            {t('shareNotRecorded')}
          </p>
        ) : null}

        <dl className={styles.stats}>
          <div>
            <dt>{t('statuses.signed_up')}</dt>
            <dd>{format.number(referralCode?.referral_count || 0)}</dd>
          </div>
          <div>
            <dt>{t('statuses.converted')}</dt>
            <dd>{format.number(referralCode?.conversion_count || 0)}</dd>
          </div>
        </dl>

        {referrals.length > 0 && (
          <ul className={styles.history} aria-label={t('invites')}>
            {referrals.map((ref) => (
              <li key={ref.id}>
                <span className={styles.status} data-status={ref.status}>
                  <span className="dot" aria-hidden="true" />
                  {STATUSES.includes(ref.status) ? t(`statuses.${ref.status}`) : ref.status}
                </span>
                {ref.source && <span className={styles.source}>{t('via', { source: ref.source })}</span>}
                <time className={styles.when} dateTime={ref.created_at}>
                  {format.dateTime(new Date(ref.created_at), { dateStyle: 'medium' })}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
