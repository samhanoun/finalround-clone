'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { SearchIcon } from '@/components/icons';
import { TableSkeleton } from '@/components/Skeleton';
import type { AdminRole } from '@/lib/adminAuth';
import styles from './AdminClient.module.css';

type Tab = 'overview' | 'users' | 'subscriptions' | 'fraud' | 'tickets';

/** The Overview's figures, counted live by /api/admin/analytics. */
interface Stats {
  totalUsers: number;
  newUsers: number;
  /** The window newUsers counts. */
  days: number;
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
  /** From Supabase Auth; null when it couldn't be read. */
  suspended: boolean | null;
}

interface Subscription {
  id: string;
  user_id: string;
  email: string;
  status: string;
  price_id: string;
  current_period_end: string;
  /** Cancelled by the user or an admin: it runs to the end of the period, then ends. */
  cancel_at_period_end: boolean;
  created_at: string;
}

interface FraudFlag {
  id: string;
  user_id: string;
  user_email: string | null;
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

/** Every admin PATCH has one shape: the action, the id of what it acts on, and the action's own fields under `data`. */
type ActionBody = { action: string; data?: Record<string, unknown> } & (
  | { user_id: string }
  | { subscription_id: string }
  | { flag_id: string }
  | { ticket_id: string }
);

/** Subscriptions still running, which can be cancelled (or, once set to end, resumed). */
const LIVE_SUBSCRIPTION = new Set(['active', 'trialing', 'past_due', 'unpaid']);

/** Searching waits for a pause in typing, rather than loading the list on every key. */
const SEARCH_DELAY_MS = 300;

const TABS: Tab[] = ['overview', 'users', 'subscriptions', 'fraud', 'tickets'];
/** Support agents answer tickets and look people up; the overview and fraud flags are for admins (their APIs refuse agents). */
const AGENT_TABS: Tab[] = ['tickets', 'users', 'subscriptions'];

/** Status, priority and severity as quiet text with a dot; colour only where it means something. */
const TONE: Record<string, 'good' | 'bad' | 'warn' | 'attention'> = {
  active: 'good',
  resolved: 'good',
  trialing: 'good',
  open: 'attention',
  waiting_user: 'attention',
  past_due: 'warn',
  unpaid: 'warn',
  incomplete: 'warn',
  canceling: 'warn',
  medium: 'warn',
  high: 'bad',
  urgent: 'bad',
  critical: 'bad',
  canceled: 'bad',
  suspended: 'bad',
};

function Status({ value }: { value: string }) {
  const t = useTranslations('Admin');
  return (
    <span className={styles.status} data-tone={TONE[value] ?? 'none'}>
      <span className={styles.dot} aria-hidden="true" />
      {t.has(`values.${value}`) ? t(`values.${value}`) : value.replace(/_/g, ' ')}
    </span>
  );
}

/** A ticket's topic in the reader's language (the user picked it from Help & support's list). */
function Category({ value }: { value: string }) {
  const t = useTranslations('Support');
  return <>{t.has(`categories.${value}`) ? t(`categories.${value}`) : value.replace(/_/g, ' ')}</>;
}

function useDates() {
  const format = useFormatter();
  return {
    formatDate: (date: string) => format.dateTime(new Date(date), { year: 'numeric', month: 'short', day: 'numeric' }),
    formatNumber: (n: number) => format.number(n),
  };
}

export default function AdminClient({ role }: { role: AdminRole }) {
  const t = useTranslations('Admin');
  const { formatDate, formatNumber } = useDates();
  const canManage = role === 'admin' || role === 'super_admin';
  // Only a super admin can make someone staff (the route refuses anyone else).
  const canGrantAdmin = role === 'super_admin';
  const tabs = canManage ? TABS : AGENT_TABS;
  const [activeTab, setActiveTab] = useState<Tab>(tabs[0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [fraudFlags, setFraudFlags] = useState<FraudFlag[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [openTicket, setOpenTicket] = useState<Ticket | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  // While an action is on its way, the action buttons wait (a second click would repeat it).
  const [pending, setPending] = useState(false);
  const page = 1;

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

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
            totalUsers: data.totals.totalUsers ?? 0,
            newUsers: data.totals.newUsers ?? 0,
            days: data.period?.days ?? 30,
            activeSubscriptions: data.totals.activeSubscriptions ?? 0,
            openTickets: data.totals.openTickets ?? 0,
            openFraudFlags: data.totals.openFraudFlags ?? 0,
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

  /** Runs an action, then reloads the tab. A refusal is shown in words where there are some for it. */
  async function act(endpoint: string, body: ActionBody, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        const code = typeof json?.error === 'string' ? json.error : '';
        setError(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('actionFailed'));
        return;
      }
      setReloadKey((key) => key + 1);
    } catch {
      setError(t('actionFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.page}>
      <nav className={styles.tabs} aria-label={t('sections')}>
        {tabs.map((tab) => {
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
              {count ? <span className={styles.count}>{formatNumber(count)}</span> : null}
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
        <div className={styles.search}>
          <SearchIcon size={16} className={styles.searchIcon} />
          <input
            className="input"
            type="search"
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
      ) : null}

      {loading ? (
        <div role="status" aria-label={t('loading')}>
          {activeTab === 'overview' ? (
            <div className={styles.stats}>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className={styles.stat}>
                  <span className={styles.skeletonLine} />
                  <span className={styles.skeletonFigure} />
                </div>
              ))}
            </div>
          ) : (
            <TableSkeleton rows={5} />
          )}
        </div>
      ) : activeTab === 'overview' ? (
        stats ? (
          <dl className={styles.stats}>
            <Stat label={t('stats.users')} value={formatNumber(stats.totalUsers)} />
            <Stat label={t('stats.newUsers', { days: stats.days })} value={formatNumber(stats.newUsers)} />
            <Stat label={t('stats.subscriptions')} value={formatNumber(stats.activeSubscriptions)} />
            <Stat label={t('stats.tickets')} value={formatNumber(stats.openTickets)} />
            <Stat label={t('stats.fraud')} value={formatNumber(stats.openFraudFlags)} />
          </dl>
        ) : null
      ) : activeTab === 'users' ? (
        <Table empty={t('empty.users')} headers={[t('cols.user'), t('cols.joined'), t('cols.subscription'), ...(canManage ? [''] : [])]}>
          {users.map((user) => (
            <tr key={user.id}>
              <td className={styles.primary}>
                <span className={styles.personName}>{user.full_name || user.email}</span>
                {user.full_name ? <span className={styles.personEmail}>{user.email}</span> : null}
                {user.suspended ? (
                  <span className={styles.personFlag}>
                    <Status value="suspended" />
                  </span>
                ) : null}
              </td>
              <td className={styles.muted} data-label={t('cols.joined')}>
                {formatDate(user.created_at)}
              </td>
              <td data-label={t('cols.subscription')}>
                {user.subscription ? <Status value={user.subscription.status} /> : <span className={styles.muted}>{t('free')}</span>}
              </td>
              {canManage ? (
                <td className={styles.actions}>
                  {canGrantAdmin ? (
                    <button
                      type="button"
                      className="button buttonGhost buttonSmall"
                      disabled={pending}
                      onClick={() =>
                        act('/api/admin/users', { action: 'set_admin', user_id: user.id, data: { role: 'admin' } }, t('confirmAdmin', { email: user.email }))
                      }
                    >
                      {t('makeAdmin')}
                    </button>
                  ) : null}
                  {user.suspended ? (
                    <button
                      type="button"
                      className="button buttonGhost buttonSmall"
                      disabled={pending}
                      onClick={() =>
                        act('/api/admin/users', { action: 'unsuspend_user', user_id: user.id }, t('confirmUnsuspend', { email: user.email }))
                      }
                    >
                      {t('unsuspend')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`button buttonGhost buttonSmall ${styles.dangerText}`}
                      disabled={pending}
                      onClick={() => act('/api/admin/users', { action: 'suspend_user', user_id: user.id }, t('confirmSuspend', { email: user.email }))}
                    >
                      {t('suspend')}
                    </button>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      ) : activeTab === 'subscriptions' ? (
        <Table empty={t('empty.subscriptions')} headers={[t('cols.user'), t('cols.status'), t('cols.price'), t('cols.renews'), ...(canManage ? [''] : [])]}>
          {subscriptions.map((sub) => {
            const live = LIVE_SUBSCRIPTION.has(sub.status);
            // Set to end: it still runs (Stripe keeps it active) until the period is over.
            const ending = live && sub.cancel_at_period_end;
            return (
              <tr key={sub.id}>
                <td className={styles.primary}>{sub.email}</td>
                <td data-label={t('cols.status')}>
                  <Status value={ending ? 'canceling' : sub.status} />
                </td>
                <td className={styles.mono} data-label={t('cols.price')}>
                  {sub.price_id || '—'}
                </td>
                <td className={styles.muted} data-label={t('cols.renews')}>
                  {sub.current_period_end ? formatDate(sub.current_period_end) : '—'}
                </td>
                {canManage ? (
                  <td className={styles.actions}>
                    {ending ? (
                      <button
                        type="button"
                        className="button buttonSmall"
                        disabled={pending}
                        onClick={() => act('/api/admin/subscriptions', { action: 'resume', subscription_id: sub.id })}
                      >
                        {t('resume')}
                      </button>
                    ) : live ? (
                      <button
                        type="button"
                        className={`button buttonGhost buttonSmall ${styles.dangerText}`}
                        disabled={pending}
                        onClick={() =>
                          act('/api/admin/subscriptions', { action: 'cancel', subscription_id: sub.id }, t('confirmCancel', { email: sub.email }))
                        }
                      >
                        {t('cancel')}
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </Table>
      ) : activeTab === 'fraud' ? (
        <Table
          empty={t('empty.fraud')}
          headers={[t('cols.user'), t('cols.type'), t('cols.severity'), t('cols.what'), t('cols.date'), ...(canManage ? [''] : [])]}
        >
          {fraudFlags.map((flag) => (
            <tr key={flag.id}>
              <td className={styles.primary}>{flag.user_email ?? flag.user_id}</td>
              <td className={styles.muted} data-label={t('cols.type')}>
                {flag.flag_type.replace(/_/g, ' ')}
              </td>
              <td data-label={t('cols.severity')}>
                <Status value={flag.severity} />
              </td>
              <td className={styles.description}>{flag.description}</td>
              <td className={styles.muted} data-label={t('cols.date')}>
                {formatDate(flag.created_at)}
              </td>
              {canManage ? (
                <td className={styles.actions}>
                  <button
                    type="button"
                    className="button buttonSmall"
                    disabled={pending}
                    onClick={() => act('/api/admin/fraud', { action: 'resolve', flag_id: flag.id })}
                  >
                    {t('resolve')}
                  </button>
                  <button
                    type="button"
                    className="button buttonGhost buttonSmall"
                    disabled={pending}
                    onClick={() => act('/api/admin/fraud', { action: 'escalate', flag_id: flag.id })}
                  >
                    {t('escalate')}
                  </button>
                  <button
                    type="button"
                    className={`button buttonGhost buttonSmall ${styles.dangerText}`}
                    disabled={pending}
                    onClick={() =>
                      act('/api/admin/fraud', { action: 'suspend_user', flag_id: flag.id }, t('confirmSuspend', { email: flag.user_email ?? flag.user_id }))
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
              <tr key={ticket.id} aria-current={openTicket?.id === ticket.id ? 'true' : undefined}>
                <td className={styles.primary}>
                  <span className={styles.personName}>{ticket.full_name || ticket.email}</span>
                  {ticket.full_name ? <span className={styles.personEmail}>{ticket.email}</span> : null}
                </td>
                <td className={styles.description}>{ticket.subject}</td>
                <td className={styles.muted} data-label={t('cols.category')}>
                  <Category value={ticket.category} />
                </td>
                <td data-label={t('cols.priority')}>
                  <Status value={ticket.priority} />
                </td>
                <td data-label={t('cols.status')}>
                  <Status value={ticket.status} />
                </td>
                <td className={styles.muted} data-label={t('cols.date')}>
                  {formatDate(ticket.created_at)}
                </td>
                <td className={styles.actions}>
                  <button type="button" className="button buttonSmall" onClick={() => setOpenTicket(ticket)}>
                    {t('open')}
                  </button>
                  <button
                    type="button"
                    className="button buttonGhost buttonSmall"
                    disabled={pending}
                    onClick={() => act('/api/admin/tickets', { action: 'update_status', ticket_id: ticket.id, data: { status: 'in_progress' } })}
                  >
                    {t('start')}
                  </button>
                  <button
                    type="button"
                    className="button buttonGhost buttonSmall"
                    disabled={pending}
                    onClick={() => act('/api/admin/tickets', { action: 'update_status', ticket_id: ticket.id, data: { status: 'resolved' } })}
                  >
                    {t('resolve')}
                  </button>
                </td>
              </tr>
            ))}
          </Table>
          {openTicket ? <TicketThread key={openTicket.id} ticket={openTicket} onClose={() => setOpenTicket(null)} /> : null}
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
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  // Only the latest load of the conversation is shown: an earlier one that answers late (it may
  // already hold a reply sent since) never replaces it, so a reply can't show twice.
  const latestLoad = useRef(0);

  const load = useCallback(async () => {
    const request = ++latestLoad.current;
    const res = await fetch(`/api/admin/tickets?ticket_id=${ticket.id}`).catch(() => null);
    const data = res?.ok ? await res.json().catch(() => null) : null;
    if (request === latestLoad.current) setMessages((current) => data?.messages ?? current ?? []);
  }, [ticket.id]);

  useEffect(() => {
    void load();
    return () => {
      // Unmounted: whatever is still loading is dropped.
      latestLoad.current += 1;
    };
  }, [load]);

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
    if (!res?.ok) {
      setSending(false);
      setNote({ ok: false, text: t('replyFailed') });
      return;
    }
    // The conversation as saved, with the reply in it once.
    await load();
    setSending(false);
    setReply('');
    setNote({ ok: true, text: t('replySent') });
  }

  return (
    <section className={styles.thread} aria-label={t('ticketLabel', { subject: ticket.subject })}>
      <div className={styles.threadHead}>
        <div className={styles.threadTitle}>
          <h3>{ticket.subject}</h3>
          <p className={styles.muted}>
            {ticket.full_name || ticket.email} · <Category value={ticket.category} /> · {formatDate(ticket.created_at)}
          </p>
        </div>
        <button type="button" className="button buttonGhost buttonSmall" onClick={onClose}>
          {t('close')}
        </button>
      </div>

      <ol className={styles.messages}>
        <li className={styles.message} data-from="user">
          <span className={styles.messageMeta}>
            {t('user')} · {formatDate(ticket.created_at)}
          </span>
          <p className={styles.bubble}>{ticket.description}</p>
        </li>
        {messages === null ? (
          <li className={styles.messageMeta}>{t('loadingThread')}</li>
        ) : (
          messages.map((message) => (
            <li key={message.id} className={styles.message} data-from={message.is_from_admin ? 'support' : 'user'}>
              <span className={styles.messageMeta}>
                {message.is_from_admin ? t('support') : t('user')} · {formatDate(message.created_at)}
              </span>
              <p className={styles.bubble}>{message.content}</p>
            </li>
          ))
        )}
      </ol>

      <form className={styles.composer} onSubmit={send}>
        <label className="label">
          {t('reply')}
          <textarea className="textarea" rows={4} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={5000} />
        </label>
        <div className={styles.composerActions}>
          <span className={note && !note.ok ? styles.noteError : styles.note} role={note && !note.ok ? 'alert' : 'status'}>
            {note?.text}
          </span>
          <button type="submit" className="button buttonPrimary" disabled={sending || !reply.trim()}>
            {sending ? t('sending') : t('sendReply')}
          </button>
        </div>
      </form>
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
  if (props.children.length === 0) return <p className="emptyState">{props.empty}</p>;
  return (
    <div className={styles.tableCard}>
      <table className={styles.table}>
        <thead>
          <tr>
            {props.headers.map((header, i) => (
              <th key={i} scope="col">
                {header || <span className="srOnly">{t('cols.actions')}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{props.children}</tbody>
      </table>
    </div>
  );
}
