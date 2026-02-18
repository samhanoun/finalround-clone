'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/browser';
import { Link } from '@/i18n/routing';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, unknown>;
  read: boolean;
  read_at: string | null;
  created_at: string;
}

export function NotificationBell() {
  const supabase = createClient();
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchUnreadCount = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('read', false);

    setUnreadCount(count || 0);
  }, [supabase]);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10);

    setNotifications(data || []);
    setLoading(false);
  }, [supabase]);

  async function markAsRead(id: string) {
    await supabase
      .from('notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('id', id);

    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, read: true } : n))
    );
    fetchUnreadCount();
  }

  async function markAllAsRead() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
    if (unreadIds.length === 0) return;

    await supabase
      .from('notifications')
      .update({ read: true, read_at: new Date().toISOString() })
      .in('id', unreadIds);

    setNotifications(prev => prev.map(n => ({ ...n, read: true, read_at: new Date().toISOString() })));
    setUnreadCount(0);
  }

  function toggleDropdown() {
    if (!isOpen) {
      fetchNotifications();
    }
    setIsOpen(!isOpen);
  }

  useEffect(() => {
    // Use setTimeout to defer the call to the next tick, avoiding synchronous state update
    const timer = setTimeout(() => {
      fetchUnreadCount();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchUnreadCount]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function formatTimeAgo(dateString: string) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  function getTypeIcon(type: string) {
    switch (type) {
      case 'interview_reminder':
        return '📅';
      case 'application_update':
        return '💼';
      case 'ai_suggestion':
        return '💡';
      default:
        return '🔔';
    }
  }

  return (
    <div className="notification-bell" ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={toggleDropdown}
        className="button"
        aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ''}`}
        style={{
          padding: '8px 12px',
          position: 'relative',
          background: 'transparent',
          border: '1px solid var(--border)',
        }}
      >
        <span style={{ fontSize: '1.2rem' }}>🔔</span>
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              background: 'var(--red)',
              color: 'white',
              borderRadius: '50%',
              width: 18,
              height: 18,
              fontSize: '0.7rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 'bold',
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="notification-dropdown"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 8,
            width: 360,
            maxHeight: 480,
            overflow: 'auto',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            zIndex: 100,
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="button"
                style={{
                  padding: '4px 8px',
                  fontSize: '0.75rem',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--fgMuted)' }}>
              Loading...
            </div>
          ) : notifications.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--fgMuted)' }}>
              No notifications yet
            </div>
          ) : (
            <div>
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  onClick={() => !notification.read && markAsRead(notification.id)}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border)',
                    cursor: notification.read ? 'default' : 'pointer',
                    background: notification.read ? 'transparent' : 'var(--bgElevated)',
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '1.2rem' }}>{getTypeIcon(notification.type)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: notification.read ? 'normal' : '600',
                          marginBottom: 4,
                        }}
                      >
                        {notification.title}
                      </div>
                      <div
                        style={{
                          fontSize: '0.85rem',
                          color: 'var(--fgMuted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {notification.message}
                      </div>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--fgMuted)',
                          marginTop: 4,
                        }}
                      >
                        {formatTimeAgo(notification.created_at)}
                      </div>
                    </div>
                    {!notification.read && (
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: 'var(--blue)',
                          flexShrink: 0,
                          marginTop: 6,
                        }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div
            style={{
              padding: '12px 16px',
              borderTop: '1px solid var(--border)',
              textAlign: 'center',
            }}
          >
            <Link
              href="/settings"
              scroll={false}
              style={{ fontSize: '0.85rem', color: 'var(--blue)' }}
            >
              Notification settings →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
