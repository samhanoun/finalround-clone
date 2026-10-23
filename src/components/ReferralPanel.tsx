'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './ReferralPanel.module.css';

/** Referral links open the sign-up form. */
function referralLink(code: string): string {
  return `${window.location.origin}/auth?mode=signup&ref=${encodeURIComponent(code)}`;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Clicked',
  signed_up: 'Signed up',
  converted: 'Upgraded',
  expired: 'Expired',
};

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
  const [referralCode, setReferralCode] = useState<ReferralCode | null>(null);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReferralData = async () => {
      try {
        const response = await fetch('/api/referrals');
        const data = await response.json();

        if (data.error) {
          setError(data.error);
        } else {
          setReferralCode(data.referral_code);
          setReferrals(data.referrals || []);
        }
      } catch (err) {
        console.error('Failed to fetch referral data:', err);
        setError('Failed to load referral data');
      } finally {
        setLoading(false);
      }
    };

    fetchReferralData();
  }, []);

  const copyReferralLink = useCallback(() => {
    if (!referralCode) return;
    
    navigator.clipboard.writeText(referralLink(referralCode.code)).then(() => {
      setCopied('link');
      setTimeout(() => setCopied(null), 2000);
    });
  }, [referralCode]);

  const copyCode = useCallback(() => {
    if (!referralCode) return;
    
    navigator.clipboard.writeText(referralCode.code).then(() => {
      setCopied('code');
      setTimeout(() => setCopied(null), 2000);
    });
  }, [referralCode]);

  const shareReferral = useCallback(async (platform: string) => {
    if (!referralCode) return;

    const referralUrl = referralLink(referralCode.code);
    const shareText = `I use Apex Round to prepare for interviews. Sign up with my code ${referralCode.code}.`;
    
    let shareUrl = '';
    const encodedUrl = encodeURIComponent(referralUrl);
    const encodedText = encodeURIComponent(shareText);

    switch (platform) {
      case 'linkedin':
        shareUrl = `https://www.linkedin.com/shareArticle?mini=true&url=${encodedUrl}&title=${encodedText}`;
        break;
      case 'twitter':
        shareUrl = `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`;
        break;
      case 'email':
        window.location.href = `mailto:?subject=Join Apex Round&body=${encodedText}%0A%0A${encodedUrl}`;
        return;
      default:
        return;
    }

    if (shareUrl) {
      window.open(shareUrl, '_blank', 'width=600,height=400');
    }

    // Record the share
    try {
      await fetch('/api/social/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          share_type: 'referral',
          platform,
          content_id: referralCode.id,
          content_title: 'Referral link shared',
        }),
      });
    } catch (error) {
      console.error('Failed to record share:', error);
    }
  }, [referralCode]);

  if (loading) {
    return <div className="small">Loading your invite link…</div>;
  }

  if (error) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <h3 className="cardTitle">Invite a friend</h3>
          <div className="error">{error}</div>
        </div>
      </div>
    );
  }

  const referralUrl = referralCode ? referralLink(referralCode.code) : '';

  return (
    <div className="card">
      <div className="cardInner stack">
        <h3 className="cardTitle">Invite a friend</h3>
        <p className="cardDesc">Share your link. Everyone who signs up with it shows up here.</p>

        <div className={styles.linkRow}>
          <input className={`input ${styles.link}`} type="text" readOnly value={referralUrl} aria-label="Your invite link" />
          <button className="button buttonPrimary" onClick={copyReferralLink}>
            {copied === 'link' ? 'Copied' : 'Copy link'}
          </button>
        </div>

        <div className={styles.meta}>
          <span>
            Code <code className={styles.code}>{referralCode?.code}</code>
          </span>
          <button className="button buttonGhost" onClick={copyCode} aria-label="Copy invite code">
            {copied === 'code' ? 'Copied' : 'Copy code'}
          </button>
        </div>

        <div className={styles.share}>
          <span className={styles.shareLabel}>Share on</span>
          <button className="button" onClick={() => shareReferral('linkedin')}>
            LinkedIn
          </button>
          <button className="button" onClick={() => shareReferral('twitter')} aria-label="Share on X">
            X
          </button>
          <button className="button" onClick={() => shareReferral('email')} aria-label="Share by email">
            Email
          </button>
        </div>

        <dl className={styles.stats}>
          <div>
            <dt>Signed up</dt>
            <dd>{referralCode?.referral_count || 0}</dd>
          </div>
          <div>
            <dt>Upgraded</dt>
            <dd>{referralCode?.conversion_count || 0}</dd>
          </div>
        </dl>

        {referrals.length > 0 && (
          <ul className={styles.history} aria-label="Invites">
            {referrals.map((ref) => (
              <li key={ref.id}>
                <span className={`badge ${ref.status === 'converted' ? 'badgeLive' : ref.status === 'signed_up' ? 'badgeIce' : ''}`}>
                  {STATUS_LABEL[ref.status] ?? ref.status}
                </span>
                {ref.source && <span className="small muted">via {ref.source}</span>}
                <span className={`small muted ${styles.when}`}>{new Date(ref.created_at).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
