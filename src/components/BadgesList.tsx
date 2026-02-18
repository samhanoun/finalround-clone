'use client';

import { useState, useEffect, useCallback } from 'react';
import { ShareMenu } from './SocialShareButton';

type Badge = {
  id: string;
  badge_type: string;
  title: string;
  description: string | null;
  icon: string | null;
  awarded_at: string;
  metadata: Record<string, unknown>;
};

const badgeIcons: Record<string, string> = {
  first_interview: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
  five_sessions: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z',
  ten_sessions: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-5 1.41-1.41L12 14.17l4.59-4.58L18 11l-6 6z',
  first_offer: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  streak_week: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  streak_month: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  resume_optimized: 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  job_applied: 'M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z',
  referral_signup: 'M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  referral_conversion: 'M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V19H7v2h10v-2h-4v-3.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z',
  share: 'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z',
};

const badgeColors: Record<string, string> = {
  first_interview: '#4CAF50',
  five_sessions: '#2196F3',
  ten_sessions: '#9C27B0',
  first_offer: '#FFD700',
  streak_week: '#FF9800',
  streak_month: '#F44336',
  resume_optimized: '#00BCD4',
  job_applied: '#8BC34A',
  referral_signup: '#E91E63',
  referral_conversion: '#FF5722',
  share: '#3F51B5',
};

export function BadgesList() {
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBadge, setSelectedBadge] = useState<Badge | null>(null);

  const fetchBadges = useCallback(async () => {
    try {
      const response = await fetch('/api/badges');
      const data = await response.json();
      setBadges(data.badges || []);
    } catch (error) {
      console.error('Failed to fetch badges:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBadges();
  }, [fetchBadges]);

  const handleShare = async (platform: string) => {
    if (!selectedBadge) return;
    
    try {
      await fetch('/api/social/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          share_type: 'badge',
          platform,
          content_id: selectedBadge.id,
          content_title: `I just earned the "${selectedBadge.title}" badge on FinalRound!`,
        }),
      });
    } catch (error) {
      console.error('Failed to share badge:', error);
    }
  };

  if (loading) {
    return <div className="small">Loading badges...</div>;
  }

  if (!badges.length) {
    return (
      <div className="card">
        <div className="cardInner stack">
          <h3 className="cardTitle">Achievements</h3>
          <p className="small muted">No badges yet. Complete interviews and activities to earn badges!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="cardInner stack">
        <h3 className="cardTitle">Achievements</h3>
        <div className="badges-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '16px' }}>
          {badges.map((badge) => (
            <button
              key={badge.id}
              onClick={() => setSelectedBadge(badge)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
                padding: '12px',
                background: 'rgba(255,255,255,0.04)',
                border: selectedBadge?.id === badge.id ? `2px solid ${badgeColors[badge.badge_type] || '#666'}` : '2px solid transparent',
                borderRadius: '12px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              aria-label={`Badge: ${badge.title}`}
            >
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  backgroundColor: badgeColors[badge.badge_type] || '#666',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff">
                  <path d={badgeIcons[badge.badge_type] || badgeIcons.share} />
                </svg>
              </div>
              <span className="small" style={{ textAlign: 'center' }}>{badge.title}</span>
            </button>
          ))}
        </div>

        {selectedBadge && (
          <div className="badge-share-modal" style={{ marginTop: '16px', padding: '16px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px' }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: '12px' }}>
              <h4 style={{ margin: 0 }}>{selectedBadge.title}</h4>
              <button 
                onClick={() => setSelectedBadge(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <p className="small muted" style={{ marginBottom: '12px' }}>{selectedBadge.description}</p>
            <p className="small mono muted">
              Awarded: {new Date(selectedBadge.awarded_at).toLocaleDateString()}
            </p>
            <div style={{ marginTop: '12px' }}>
              <p className="small" style={{ marginBottom: '8px' }}>Share your achievement:</p>
              <ShareMenu 
                content={{
                  title: `I just earned the "${selectedBadge.title}" badge on FinalRound!`,
                  summary: selectedBadge.description || 'Check out my achievement on FinalRound - the AI-powered interview prep platform!',
                }}
                onShare={handleShare}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
