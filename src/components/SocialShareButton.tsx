'use client';

import { useState, useCallback } from 'react';

type Platform = 'linkedin' | 'twitter' | 'facebook' | 'email';

interface ShareContent {
  title: string;
  summary?: string;
  url?: string;
}

interface SocialShareButtonProps {
  platform: Platform;
  content: ShareContent;
  onShare?: (platform: Platform) => void;
  variant?: 'icon' | 'button';
  size?: 'sm' | 'md' | 'lg';
}

const platformConfig: Record<Platform, { label: string; color: string; icon: string }> = {
  linkedin: {
    label: 'LinkedIn',
    color: '#0077B5',
    icon: 'M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z',
  },
  twitter: {
    label: 'Twitter/X',
    color: '#1DA1F2',
    icon: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
  },
  facebook: {
    label: 'Facebook',
    color: '#1877F2',
    icon: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z',
  },
  email: {
    label: 'Email',
    color: '#EA4335',
    icon: 'M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z',
  },
};

export function SocialShareButton({ platform, content, onShare, variant = 'button', size = 'md' }: SocialShareButtonProps) {
  const [loading, setLoading] = useState(false);
  const config = platformConfig[platform];

  const handleShare = useCallback(async () => {
    setLoading(true);
    try {
      // Get share URL from API
      const response = await fetch('/api/social/shares', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          content_title: content.title,
          content_url: content.url,
          content_summary: content.summary,
        }),
      });

      const data = await response.json();
      
      if (data.share_url) {
        // Open share URL in a new window
        if (platform === 'email') {
          window.location.href = data.share_url;
        } else {
          window.open(data.share_url, '_blank', 'width=600,height=400');
        }
        
        // Record the share
        await fetch('/api/social/shares', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            share_type: 'interview_report',
            platform,
            content_title: content.title,
            content_url: content.url,
          }),
        });
        
        onShare?.(platform);
      }
    } catch (error) {
      console.error('Share error:', error);
    } finally {
      setLoading(false);
    }
  }, [platform, content, onShare]);

  const buttonStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: size === 'sm' ? '8px 12px' : size === 'lg' ? '16px 24px' : '12px 16px',
    backgroundColor: variant === 'icon' ? 'transparent' : config.color,
    color: variant === 'icon' ? config.color : '#fff',
    border: variant === 'icon' ? `2px solid ${config.color}` : 'none',
    borderRadius: '8px',
    cursor: loading ? 'wait' : 'pointer',
    fontSize: size === 'sm' ? '14px' : size === 'lg' ? '18px' : '16px',
    fontWeight: 600,
    transition: 'all 0.2s ease',
    opacity: loading ? 0.7 : 1,
  };

  return (
    <button
      style={buttonStyle}
      onClick={handleShare}
      disabled={loading}
      aria-label={`Share on ${config.label}`}
      title={`Share on ${config.label}`}
    >
      <svg
        width={size === 'sm' ? 16 : size === 'lg' ? 24 : 20}
        height={size === 'sm' ? 16 : size === 'lg' ? 24 : 20}
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d={config.icon} />
      </svg>
      {variant === 'button' && config.label}
    </button>
  );
}

interface ShareMenuProps {
  content: ShareContent;
  onShare?: (platform: Platform) => void;
}

export function ShareMenu({ content, onShare }: ShareMenuProps) {
  return (
    <div className="share-menu" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
      <SocialShareButton platform="linkedin" content={content} onShare={onShare} />
      <SocialShareButton platform="twitter" content={content} onShare={onShare} />
      <SocialShareButton platform="facebook" content={content} onShare={onShare} />
      <SocialShareButton platform="email" content={content} onShare={onShare} />
    </div>
  );
}
