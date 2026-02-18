'use client';

import { useState, useEffect, useCallback } from 'react';

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
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReferralData = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    fetchReferralData();
  }, [fetchReferralData]);

  const copyReferralLink = useCallback(() => {
    if (!referralCode) return;
    
    // Build referral URL
    const referralUrl = `${window.location.origin}/signup?ref=${referralCode.code}`;
    
    navigator.clipboard.writeText(referralUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [referralCode]);

  const copyCode = useCallback(() => {
    if (!referralCode) return;
    
    navigator.clipboard.writeText(referralCode.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [referralCode]);

  const shareReferral = useCallback(async (platform: string) => {
    if (!referralCode) return;

    const referralUrl = `${window.location.origin}/signup?ref=${referralCode.code}`;
    const shareText = `Join me on FinalRound - the AI-powered interview prep platform! Use my referral code: ${referralCode.code}`;
    
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
        window.location.href = `mailto:?subject=Join FinalRound&body=${encodedText}%0A%0A${encodedUrl}`;
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
    return <div className="small">Loading referral data...</div>;
  }

  if (error) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <h3 className="cardTitle">Referral Program</h3>
          <div className="error">{error}</div>
        </div>
      </div>
    );
  }

  const referralUrl = referralCode ? `${window.location.origin}/signup?ref=${referralCode.code}` : '';

  return (
    <div className="card">
      <div className="cardInner stack">
        <h3 className="cardTitle">Referral Program</h3>
        <p className="cardDesc">
          Invite friends to join FinalRound and earn rewards! You get benefits when they sign up and convert.
        </p>

        {/* Referral Code & Link */}
        <div className="referral-code-section" style={{ 
          padding: '16px', 
          background: 'rgba(255,255,255,0.04)', 
          borderRadius: '8px',
          marginBottom: '16px'
        }}>
          <label className="label" style={{ marginBottom: '8px' }}>
            Your Referral Code
          </label>
          <div className="row" style={{ gap: '8px', marginBottom: '12px' }}>
            <code 
              style={{ 
                flex: 1, 
                padding: '12px', 
                background: 'rgba(0,0,0,0.3)', 
                borderRadius: '6px',
                fontSize: '18px',
                fontWeight: 'bold',
                letterSpacing: '2px',
                textAlign: 'center',
              }}
            >
              {referralCode?.code}
            </code>
            <button 
              className="button"
              onClick={copyCode}
              aria-label="Copy referral code"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>

          <label className="label" style={{ marginBottom: '8px' }}>
            Referral Link
          </label>
          <div className="row" style={{ gap: '8px' }}>
            <input 
              type="text"
              readOnly
              value={referralUrl}
              style={{ 
                flex: 1, 
                padding: '12px', 
                background: 'rgba(0,0,0,0.3)', 
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                color: 'var(--muted)',
                fontSize: '14px',
              }}
              aria-label="Referral link"
            />
            <button 
              className="button buttonPrimary"
              onClick={copyReferralLink}
              aria-label="Copy referral link"
            >
              {copied ? '✓ Copied' : 'Copy Link'}
            </button>
          </div>
        </div>

        {/* Share Buttons */}
        <div className="share-section" style={{ marginBottom: '16px' }}>
          <p className="small" style={{ marginBottom: '8px' }}>Share via:</p>
          <div className="row" style={{ gap: '8px', flexWrap: 'wrap' }}>
            <button 
              className="button"
              style={{ background: '#0077B5', color: '#fff' }}
              onClick={() => shareReferral('linkedin')}
              aria-label="Share on LinkedIn"
            >
              LinkedIn
            </button>
            <button 
              className="button"
              style={{ background: '#1DA1F2', color: '#fff' }}
              onClick={() => shareReferral('twitter')}
              aria-label="Share on Twitter"
            >
              Twitter/X
            </button>
            <button 
              className="button"
              style={{ background: '#EA4335', color: '#fff' }}
              onClick={() => shareReferral('email')}
              aria-label="Share via Email"
            >
              Email
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="stats-grid" style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr', 
          gap: '12px',
          marginBottom: '16px'
        }}>
          <div style={{ 
            padding: '16px', 
            background: 'rgba(255,255,255,0.04)', 
            borderRadius: '8px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#4CAF50' }}>
              {referralCode?.referral_count || 0}
            </div>
            <div className="small muted">Total Referrals</div>
          </div>
          <div style={{ 
            padding: '16px', 
            background: 'rgba(255,255,255,0.04)', 
            borderRadius: '8px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#FFD700' }}>
              {referralCode?.conversion_count || 0}
            </div>
            <div className="small muted">Conversions</div>
          </div>
        </div>

        {/* Referral History */}
        {referrals.length > 0 && (
          <div className="referral-history">
            <h4 style={{ marginBottom: '12px' }}>Referral History</h4>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {referrals.map((ref) => (
                <li 
                  key={ref.id}
                  style={{ 
                    padding: '12px', 
                    background: 'rgba(255,255,255,0.04)', 
                    borderRadius: '6px',
                    marginBottom: '8px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <span 
                      className="badge"
                      style={{ 
                        background: ref.status === 'converted' ? '#4CAF50' : 
                                   ref.status === 'signed_up' ? '#2196F3' : 
                                   ref.status === 'pending' ? '#FF9800' : '#666',
                        marginRight: '8px'
                      }}
                    >
                      {ref.status}
                    </span>
                    {ref.source && <span className="small muted">via {ref.source}</span>}
                  </div>
                  <span className="small mono muted">
                    {new Date(ref.created_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Tracking Link for Signup */}
        <p className="small muted" style={{ marginTop: '16px' }}>
          When someone uses your referral link, we will track their progress and credit you when they convert!
        </p>
      </div>
    </div>
  );
}
