'use client';

import { useState, useCallback } from 'react';
import { ShareMenu } from './SocialShareButton';

interface InterviewReport {
  id: string;
  title: string;
  sessionId: string;
  score?: number;
  notes?: string;
  rubric?: Record<string, unknown>;
  created_at: string;
}

interface ShareReportProps {
  report: InterviewReport;
}

export function ShareReport({ report }: ShareReportProps) {
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [hasShared, setHasShared] = useState(false);

  const handleShare = useCallback(async (platform: string) => {
    setHasShared(true);
    setShowShareMenu(false);
    
    // Score-based message
    let message = '';
    if (report.score !== undefined) {
      if (report.score >= 90) {
        message = `🎉 I just scored ${report.score}% on my mock interview practice! Ready to land my dream job!`;
      } else if (report.score >= 70) {
        message = `📝 I scored ${report.score}% on my interview practice with FinalRound. Getting better every day!`;
      } else {
        message = `💪 Working hard on my interview skills! Scored ${report.score}% on my latest practice session.`;
      }
    } else {
      message = `Just completed an interview practice session on FinalRound! Check out my progress.`;
    }

    // Record the share
    try {
      await fetch('/api/social/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          share_type: 'interview_report',
          platform,
          content_id: report.sessionId,
          content_title: message,
          metadata: {
            score: report.score,
            report_id: report.id,
          },
        }),
      });
    } catch (error) {
      console.error('Failed to record share:', error);
    }
  }, [report]);

  const shareUrl = typeof window !== 'undefined' 
    ? `${window.location.origin}/interview/${report.sessionId}/report`
    : '';

  return (
    <div className="share-report" style={{ marginTop: '16px' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Share Your Results</h3>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            Show off your progress and inspire others!
          </p>
        </div>
        <button 
          className={`button ${hasShared ? '' : 'buttonPrimary'}`}
          onClick={() => setShowShareMenu(!showShareMenu)}
          aria-expanded={showShareMenu}
          aria-label="Share interview report"
        >
          {hasShared ? '✓ Shared' : 'Share Results'}
        </button>
      </div>

      {showShareMenu && (
        <div 
          style={{ 
            marginTop: '16px', 
            padding: '16px', 
            background: 'rgba(255,255,255,0.04)', 
            borderRadius: '8px' 
          }}
        >
          <p className="small" style={{ marginBottom: '12px' }}>
            Choose a platform to share your interview report:
          </p>
          <ShareMenu 
            content={{
              title: report.score !== undefined 
                ? `I scored ${report.score}% on my interview practice!`
                : `Check out my interview practice session on FinalRound!`,
              summary: report.notes 
                ? `My feedback: ${report.notes.substring(0, 150)}...`
                : 'Using FinalRound - the AI-powered interview prep platform!',
              url: shareUrl,
            }}
            onShare={handleShare}
          />
        </div>
      )}
    </div>
  );
}

// Compact share button for inline use
interface ShareButtonProps {
  report: InterviewReport;
  variant?: 'icon' | 'text';
}

export function ShareButton({ report, variant = 'text' }: ShareButtonProps) {
  const [clicked, setClicked] = useState(false);

  const handleClick = useCallback(async () => {
    setClicked(true);
    
    const message = report.score !== undefined 
      ? `I scored ${report.score}% on my interview practice with FinalRound!`
      : `Just completed an interview practice session on FinalRound!`;

    const shareUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/interview/${report.sessionId}/report`
      : '';

    // Open Twitter share as default
    const encodedText = encodeURIComponent(message);
    const encodedUrl = encodeURIComponent(shareUrl);
    window.open(`https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`, '_blank');

    // Record share
    try {
      await fetch('/api/social/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          share_type: 'interview_report',
          platform: 'twitter',
          content_id: report.sessionId,
          content_title: message,
        }),
      });
    } catch (error) {
      console.error('Failed to record share:', error);
    }

    setTimeout(() => setClicked(false), 3000);
  }, [report]);

  if (variant === 'icon') {
    return (
      <button 
        onClick={handleClick}
        disabled={clicked}
        style={{
          background: 'none',
          border: 'none',
          cursor: clicked ? 'default' : 'pointer',
          padding: '8px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.2s',
        }}
        aria-label="Share to Twitter"
        title="Share to Twitter"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </button>
    );
  }

  return (
    <button 
      className="button"
      onClick={handleClick}
      disabled={clicked}
      style={{ 
        background: '#1DA1F2',
        color: '#fff',
        border: 'none',
      }}
    >
      {clicked ? '✓ Shared!' : 'Share'}
    </button>
  );
}
