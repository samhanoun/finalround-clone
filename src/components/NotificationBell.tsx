'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/browser';
import { Link, useRouter } from '@/i18n/routing';
import { useFormatter, useTranslations } from 'next-intl';
import { notificationText } from '@/lib/notificationText';
import { BellIcon, CalendarIcon, JobsIcon, SparkIcon } from './icons';
import styles from './NotificationBell.module.css';

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

/** `placement="side"`: in the desktop sidebar, the list opens to the right. On phones it spans the screen. */
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
    <div className={`notification-bell ${styles.bell}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={toggleDropdown}
        className="iconButton"
        aria-label={unreadCount > 0 ? t('labelUnread', { count: unreadCount }) : t('label')}
        aria-expanded={isOpen}
      >
        <BellIcon size={18} />
        {unreadCount > 0 ? <span className={styles.unreadDot} aria-hidden="true" /> : null}
      </button>

      {isOpen && (
        <div className={`notification-dropdown ${styles.panel} ${placement === 'side' ? styles.side : styles.below}`}>
          <div className={styles.header}>
            <h2 className={styles.title}>{t('title')}</h2>
            {unreadCount > 0 && (
              <button type="button" onClick={markAllAsRead} className="button buttonGhost buttonSmall">
                {t('markAllRead')}
              </button>
            )}
          </div>

          {loading ? (
            <div className={styles.note}>{t('loading')}</div>
          ) : notifications.length === 0 ? (
            <div className={styles.note}>{t('empty')}</div>
          ) : (
            <div className={styles.list}>
              {notifications.map((notification) => {
                const text = notificationText(notification, tn, format);
                const actionable = Boolean(linkOf(notification)) || !notification.read;
                return (
                  <div
                    key={notification.id}
                    role={linkOf(notification) ? 'link' : undefined}
                    tabIndex={actionable ? 0 : undefined}
                    onClick={() => openNotification(notification)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') openNotification(notification);
                    }}
                    className={`${styles.item} ${actionable ? styles.actionable : ''} ${notification.read ? '' : styles.unread}`}
                  >
                    <span className={styles.icon}>{getTypeIcon(notification.type)}</span>
                    <div className={styles.body}>
                      <div className={styles.itemTitle}>{text.title}</div>
                      <div className={styles.message}>{text.message}</div>
                      <div className={styles.time}>{formatTimeAgo(notification.created_at)}</div>
                    </div>
                    {!notification.read ? <span className={styles.itemDot} aria-hidden="true" /> : null}
                  </div>
                );
              })}
            </div>
          )}

          <div className={styles.footer}>
            <Link href="/settings#notifications" className={styles.settingsLink} onClick={() => setIsOpen(false)}>
              {t('settings')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
