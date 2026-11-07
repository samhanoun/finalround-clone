'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/browser';
import { Link, useRouter } from '@/i18n/routing';
import { useFormatter, useTranslations } from 'next-intl';
import { notificationText } from '@/lib/notificationText';
import { BellIcon, CalendarIcon, JobsIcon, SparkIcon } from './icons';

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

/** `placement="side"`: in the navigation rail, the list opens to the right. */
export function NotificationBell({ placement = 'below' }: { placement?: 'below' | 'side' } = {}) {
  const supabase = createClient();
  const router = useRouter();
  const t = useTranslations('NotificationBell');
  const tn = useTranslations('Notifications');
  const format = useFormatter();
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

  /** An in-app path the notification points to (set by src/lib/notify.ts). */
  function linkOf(notification: Notification): string | null {
    const url = notification.data?.url;
    return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : null;
  }

  function openNotification(notification: Notification) {
    if (!notification.read) void markAsRead(notification.id);
    const url = linkOf(notification);
    if (url) {
      setIsOpen(false);
      router.push(url);
    }
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
    const diffMins = Math.floor((now.getTime() - date.getTime()) / 60000);

    if (diffMins < 1) return t('justNow');
    if (diffMins < 7 * 24 * 60) return format.relativeTime(date, now);
    return format.dateTime(date, { day: 'numeric', month: 'short' });
  }

  function getTypeIcon(type: string) {
    switch (type) {
      case 'interview_reminder':
        return <CalendarIcon size={18} />;
      case 'application_update':
        return <JobsIcon size={18} />;
      case 'ai_suggestion':
        return <SparkIcon size={18} />;
      default:
        return <BellIcon size={18} />;
    }
  }

  return (
    <div className="notification-bell" ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={toggleDropdown}
        className="button buttonGhost"
        aria-label={unreadCount > 0 ? t('labelUnread', { count: unreadCount }) : t('label')}
        style={{ padding: 0, width: 44, position: 'relative' }}
      >
        <BellIcon size={20} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              background: 'var(--ember)',
              color: 'var(--midnight)',
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
            ...(placement === 'side'
              ? { left: '100%', bottom: 0, marginLeft: 12 }
              : { top: '100%', right: 0, marginTop: 8 }),
            width: 'min(360px, calc(100vw - 32px))',
            maxHeight: 480,
            overflow: 'auto',
            background: 'var(--deck)',
            border: '1px solid var(--line-strong)',
            borderRadius: 14,
            boxShadow: 'var(--float)',
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
            <h3 style={{ margin: 0, fontSize: '1rem' }}>{t('title')}</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="button buttonGhost"
                style={{ minHeight: 32, padding: '0 10px', fontSize: 13 }}
              >
                {t('markAllRead')}
              </button>
            )}
          </div>

          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--fgMuted)' }}>
              {t('loading')}
            </div>
          ) : notifications.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--fgMuted)' }}>
              {t('empty')}
            </div>
          ) : (
            <div>
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  role={linkOf(notification) ? 'link' : undefined}
                  tabIndex={linkOf(notification) || !notification.read ? 0 : undefined}
                  onClick={() => openNotification(notification)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') openNotification(notification);
                  }}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border)',
                    cursor: linkOf(notification) || !notification.read ? 'pointer' : 'default',
                    background: notification.read ? 'transparent' : 'var(--bgElevated)',
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <span style={{ display: 'inline-flex', color: 'var(--mist)' }}>{getTypeIcon(notification.type)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: notification.read ? 'normal' : '600',
                          marginBottom: 4,
                        }}
                      >
                        {notificationText(notification, tn, format).title}
                      </div>
                      <div
                        style={{
                          fontSize: '0.85rem',
                          color: 'var(--fgMuted)',
                          overflow: 'hidden',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {notificationText(notification, tn, format).message}
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
              style={{ fontSize: 14, color: 'var(--ice)' }}
            >
              {t('settings')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
