'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { AdminRole } from '@/lib/adminAuth';
import styles from './AdminClient.module.css';

type Tab = 'overview' | 'users' | 'subscriptions' | 'fraud' | 'tickets';

interface Stats {
  totalUsers: number;
  activeUsers: number;
  totalRevenue: number;
  activeSubscriptions: number;
  openTickets: number;
  openFraudFlags: number;
}

interface User {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  subscription: { status: string; current_period_end: string } | null;
}

interface Subscription {
  id: string;
  user_id: string;
  email: string;
  status: string;
  price_id: string;
  current_period_end: string;
  created_at: string;
}

interface FraudFlag {
  id: string;
  user_id: string;
  user_email: string;
  flag_type: string;
  severity: string;
  description: string;
  resolved: boolean;
  created_at: string;
}

interface Ticket {
  id: string;
  email: string;
  full_name: string | null;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  created_at: string;
}

const TABS: Tab[] = ['overview', 'users', 'subscriptions', 'fraud', 'tickets'];

const TONE: Record<string, string> = {
  active: 'badgeLive',
  resolved: 'badgeLive',
  open: 'badgeIce',
  in_progress: 'badgePro',
  past_due: 'badgePro',
  medium: 'badgePro',
  high: 'badgeAlert',
  urgent: 'badgeAlert',
  critical: 'badgeAlert',
  canceled: 'badgeAlert',
};

function Badge({ value }: { value: string }) {
  const t = useTranslations('Admin');
  return <span className={`badge ${TONE[value] ?? ''}`}>{t.has(`values.${value}`) ? t(`values.${value}`) : value.replace(/_/g, ' ')}</span>;
}

function useDates() {
  const format = useFormatter();
  return {
    formatDate: (date: string) => format.dateTime(new Date(date), { year: 'numeric', month: 'short', day: 'numeric' }),
    formatCurrency: (cents: number) => format.number(cents / 100, { style: 'currency', currency: 'USD' }),
    formatNumber: (n: number) => format.number(n),
  };
}

export default function AdminClient({ role }: { role: AdminRole }) {
  const t = useTranslations('Admin');
  const { formatDate, formatCurrency, formatNumber } = useDates();
  const canManage = role === 'admin' || role === 'super_admin';
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [fraudFlags, setFraudFlags] = useState<FraudFlag[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [openTicket, setOpenTicket] = useState<Ticket | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const page = 1;
  // Data is refetched when the tab or search changes, or when an action bumps reloadKey.
  const [reloadKey, setReloadKey] = useState(0);
  const fetchKey = `${activeTab}|${searchQuery}|${reloadKey}`;
  const [loadingKey, setLoadingKey] = useState(fetchKey);
  if (loadingKey !== fetchKey) {
    setLoadingKey(fetchKey);
    setLoading(true);
  }

  useEffect(() => {
    // A response for an outdated request (an earlier search) is dropped.
    let cancelled = false;
    const get = async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    };
    (async () => {
      try {
        setError(null);
        if (activeTab === 'overview') {
          const data = await get('/api/admin/analytics?period=30d');
          if (cancelled || !data.totals) return;
          setStats({
            totalUsers: data.totals.totalUsers || 0,
            activeUsers: data.totals.activeUsers || 0,
            totalRevenue: data.totals.totalRevenue || 0,
            activeSubscriptions: data.totals.activeSubscriptions || 0,
            openTickets: data.totals.ticketsOpened || 0,
            openFraudFlags: data.totals.fraudFlags || 0,
          });
        } else if (activeTab === 'users') {
          const data = await get(`/api/admin/users?page=${page}&limit=20&search=${encodeURIComponent(searchQuery)}`);
          if (!cancelled) setUsers(data.users || []);
        } else if (activeTab === 'subscriptions') {
          const data = await get(`/api/admin/subscriptions?page=${page}&limit=20`);
          if (!cancelled) setSubscriptions(data.subscriptions || []);
        } else if (activeTab === 'fraud') {
          const data = await get(`/api/admin/fraud?page=${page}&limit=20&resolved=false`);
          if (!cancelled) setFraudFlags(data.flags || []);
        } else {
          // Everything still needing attention: open, in progress or waiting on the user.
          const data = await get(`/api/admin/tickets?page=${page}&limit=50`);
          if (!cancelled) {
            setTickets(((data.tickets || []) as Ticket[]).filter((ticket) => ticket.status !== 'resolved' && ticket.status !== 'closed'));
          }
        }
      } catch {
        if (!cancelled) setError(t('loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, searchQuery, reloadKey, t]);

  async function act(endpoint: string, action: string, data: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...data }),
      });
      if (!res.ok) throw new Error();
      setReloadKey((key) => key + 1);
    } catch {
      setError(t('actionFailed'));
    }
  }

  return (
    <div className={styles.page}>
      <nav className={styles.tabs} aria-label={t('sections')}>
        {TABS.map((tab) => {
          const count = tab === 'tickets' ? stats?.openTickets : tab === 'fraud' ? stats?.openFraudFlags : 0;
          return (
            <button
              key={tab}
              type="button"
              className={styles.tab}
              aria-current={activeTab === tab ? 'page' : undefined}
              onClick={() => setActiveTab(tab)}
            >
              {t(`tabs.${tab}`)}
              {count ? <span className={styles.count} data-tone={tab === 'fraud' ? 'alert' : 'ice'}>{count}</span> : null}
            </button>
          );
        })}
      </nav>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {activeTab === 'users' ? (
        <input
          className={`input ${styles.search}`}
          type="search"
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchLabel')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      ) : null}

      {loading ? (
        <p className="help">{t('loading')}</p>
      ) : activeTab === 'overview' ? (
        stats ? (
          <dl className={styles.stats}>
            <Stat label={t('stats.users')} value={formatNumber(stats.totalUsers)} />
            <Stat label={t('stats.active')} value={formatNumber(stats.activeUsers)} />
            <Stat label={t('stats.revenue')} value={formatCurrency(stats.totalRevenue)} />
            <Stat label={t('stats.subscriptions')} value={formatNumber(stats.activeSubscriptions)} />
            <Stat label={t('stats.tickets')} value={formatNumber(stats.openTickets)} />
            <Stat label={t('stats.fraud')} value={formatNumber(stats.openFraudFlags)} />
          </dl>
        ) : null
      ) : activeTab === 'users' ? (
        <Table empty={t('empty.users')} headers={[t('cols.user'), t('cols.joined'), t('cols.subscription'), ...(canManage ? [''] : [])]}>
          {users.map((user) => (
            <tr key={user.id}>
              <td>
                <span className={styles.personName}>{user.full_name || user.email}</span>
                {user.full_name ? <span className={styles.personEmail}>{user.email}</span> : null}
              </td>
              <td className={styles.muted}>{formatDate(user.created_at)}</td>
              <td>{user.subscription ? <Badge value={user.subscription.status} /> : <span className={styles.muted}>{t('free')}</span>}</td>
              {canManage ? (
                <td className={styles.actions}>
                  <button
                    type="button"
                    className="button buttonGhost"
                    onClick={() => act('/api/admin/users', 'set_admin', { user_id: user.id, role: 'admin' }, t('confirmAdmin', { email: user.email }))}
                  >
                    {t('makeAdmin')}
                  </button>
                  <button
                    type="button"
                    className="button buttonDanger"
                    onClick={() => act('/api/admin/users', 'suspend_user', { user_id: user.id }, t('confirmSuspend', { email: user.email }))}
                  >
                    {t('suspend')}
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      ) : activeTab === 'subscriptions' ? (
        <Table empty={t('empty.subscriptions')} headers={[t('cols.user'), t('cols.status'), t('cols.price'), t('cols.renews'), ...(canManage ? [''] : [])]}>
          {subscriptions.map((sub) => (
            <tr key={sub.id}>
              <td>{sub.email}</td>
              <td>
                <Badge value={sub.status} />
              </td>
              <td className={styles.mono}>{sub.price_id || '—'}</td>
              <td className={styles.muted}>{sub.current_period_end ? formatDate(sub.current_period_end) : '—'}</td>
              {canManage ? (
                <td className={styles.actions}>
                  {sub.status === 'active' ? (
                    <button
                      type="button"
                      className="button buttonDanger"
                      onClick={() => act('/api/admin/subscriptions', 'cancel', { subscription_id: sub.id }, t('confirmCancel', { email: sub.email }))}
                    >
                      {t('cancel')}
                    </button>
                  ) : (
                    <button type="button" className="button" onClick={() => act('/api/admin/subscriptions', 'resume', { subscription_id: sub.id })}>
                      {t('resume')}
                    </button>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      ) : activeTab === 'fraud' ? (
        <Table
          empty={t('empty.fraud')}
          headers={[t('cols.user'), t('cols.type'), t('cols.severity'), t('cols.what'), t('cols.date'), ...(canManage ? [''] : [])]}
        >
          {fraudFlags.map((flag) => (
            <tr key={flag.id}>
              <td>{flag.user_email}</td>
              <td className={styles.muted}>{flag.flag_type.replace(/_/g, ' ')}</td>
              <td>
                <Badge value={flag.severity} />
              </td>
              <td className={styles.description}>{flag.description}</td>
              <td className={styles.muted}>{formatDate(flag.created_at)}</td>
              {canManage ? (
                <td className={styles.actions}>
                  <button type="button" className="button" onClick={() => act('/api/admin/fraud', 'resolve', { flag_id: flag.id })}>
                    {t('resolve')}
                  </button>
                  <button type="button" className="button buttonGhost" onClick={() => act('/api/admin/fraud', 'escalate', { flag_id: flag.id })}>
                    {t('escalate')}
                  </button>
                  <button
                    type="button"
                    className="button buttonDanger"
                    onClick={() =>
                      act(
                        '/api/admin/fraud',
                        'suspend_user',
                        { flag_id: flag.id, description: 'Suspended due to fraud' },
                        t('confirmSuspend', { email: flag.user_email }),
                      )
                    }
                  >
                    {t('suspend')}
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      ) : (
        <>
        <Table
          empty={t('empty.tickets')}
          headers={[t('cols.from'), t('cols.subject'), t('cols.category'), t('cols.priority'), t('cols.status'), t('cols.date'), '']}
        >
          {tickets.map((ticket) => (
            <tr key={ticket.id}>
              <td>
                <span className={styles.personName}>{ticket.full_name || ticket.email}</span>
                {ticket.full_name ? <span className={styles.personEmail}>{ticket.email}</span> : null}
              </td>
              <td className={styles.description}>{ticket.subject}</td>
              <td className={styles.muted}>{ticket.category}</td>
              <td>
                <Badge value={ticket.priority} />
              </td>
              <td>
                <Badge value={ticket.status} />
              </td>
              <td className={styles.muted}>{formatDate(ticket.created_at)}</td>
              <td className={styles.actions}>
                <button type="button" className="button buttonPrimary" onClick={() => setOpenTicket(ticket)}>
                  {t('open')}
                </button>
                <button
                  type="button"
                  className="button buttonGhost"
                  onClick={() => act('/api/admin/tickets', 'update_status', { ticket_id: ticket.id, data: { status: 'in_progress' } })}
                >
                  {t('start')}
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => act('/api/admin/tickets', 'update_status', { ticket_id: ticket.id, data: { status: 'resolved' } })}
                >
                  {t('resolve')}
                </button>
              </td>
            </tr>
          ))}
        </Table>
        {openTicket ? <TicketThread ticket={openTicket} onClose={() => setOpenTicket(null)} /> : null}
        </>
      )}
    </div>
  );
}

/** One ticket: what the user wrote, the conversation, and a reply box (the user is emailed). */
function TicketThread({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const t = useTranslations('Admin');
  const { formatDate } = useDates();
  const [messages, setMessages] = useState<Array<{ id: string; is_from_admin: boolean; content: string; created_at: string }> | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/admin/tickets?ticket_id=${ticket.id}`).catch(() => null);
      const data = res?.ok ? await res.json() : { messages: [] };
      if (!cancelled) setMessages(data.messages ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [ticket.id]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    setNote(null);
    const res = await fetch('/api/admin/tickets', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket_id: ticket.id, action: 'reply', data: { content: reply } }),
    }).catch(() => null);
    setSending(false);
    if (!res?.ok) {
      setNote(t('replyFailed'));
      return;
    }
    setMessages((current) => [
      ...(current ?? []),
      { id: `local-${Date.now()}`, is_from_admin: true, content: reply.trim(), created_at: new Date().toISOString() },
    ]);
    setReply('');
    setNote(t('replySent'));
  }

  return (
    <section className={`card ${styles.thread}`} aria-label={t('ticketLabel', { subject: ticket.subject })}>
      <div className="cardInner stack">
        <div className={styles.threadHead}>
          <h3 className="cardTitle">{ticket.subject}</h3>
          <button type="button" className="button buttonGhost" onClick={onClose}>
            {t('close')}
          </button>
        </div>
        <p className={styles.muted}>
          {ticket.full_name || ticket.email} · {ticket.category} · {formatDate(ticket.created_at)}
        </p>
        <p className={styles.threadBody}>{ticket.description}</p>
        {messages === null ? (
          <p className="help">{t('loadingThread')}</p>
        ) : (
          <ol className={styles.threadList}>
            {messages.map((message) => (
              <li key={message.id} data-from={message.is_from_admin ? 'support' : 'user'}>
                <span className={styles.muted}>
                  {message.is_from_admin ? t('support') : t('user')} · {formatDate(message.created_at)}
                </span>
                <p>{message.content}</p>
              </li>
            ))}
          </ol>
        )}
        <form className="stack" onSubmit={send}>
          <label className="label">
            {t('reply')}
            <textarea className="textarea" rows={4} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={5000} />
          </label>
          <div className={styles.actions}>
            {note ? <span className="help">{note}</span> : null}
            <button type="submit" className="button buttonPrimary" disabled={sending || !reply.trim()}>
              {sending ? t('sending') : t('sendReply')}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Table(props: { headers: string[]; empty: string; children: React.ReactNode[] }) {
  const t = useTranslations('Admin');
  if (props.children.length === 0) return <p className={`card ${styles.note}`}>{props.empty}</p>;
  return (
    <div className={`card ${styles.tableCard}`}>
      <table className={styles.table}>
        <thead>
          <tr>
            {props.headers.map((header, i) => (
              <th key={i} scope="col" aria-label={header ? undefined : t('cols.actions')}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{props.children}</tbody>
      </table>
    </div>
  );
}
