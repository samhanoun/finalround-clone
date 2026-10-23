'use client';

import { useEffect, useState } from 'react';
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
  category: string;
  priority: string;
  status: string;
  created_at: string;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'fraud', label: 'Fraud flags' },
  { id: 'tickets', label: 'Support tickets' },
];

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
  return <span className={`badge ${TONE[value] ?? ''}`}>{value.replace(/_/g, ' ')}</span>;
}

const formatCurrency = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const formatDate = (date: string) => new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export default function AdminClient({ role }: { role: AdminRole }) {
  const canManage = role === 'admin' || role === 'super_admin';
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [fraudFlags, setFraudFlags] = useState<FraudFlag[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
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
          const data = await get(`/api/admin/tickets?page=${page}&limit=20&status=open`);
          if (!cancelled) setTickets(data.tickets || []);
        }
      } catch {
        if (!cancelled) setError("This section didn't load. Reload the page to try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, searchQuery, reloadKey]);

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
      setError("That action didn't go through. Try again.");
    }
  }

  return (
    <div className={styles.page}>
      <nav className={styles.tabs} aria-label="Admin sections">
        {TABS.map((tab) => {
          const count = tab.id === 'tickets' ? stats?.openTickets : tab.id === 'fraud' ? stats?.openFraudFlags : 0;
          return (
            <button
              key={tab.id}
              type="button"
              className={styles.tab}
              aria-current={activeTab === tab.id ? 'page' : undefined}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              {count ? <span className={styles.count} data-tone={tab.id === 'fraud' ? 'alert' : 'ice'}>{count}</span> : null}
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
          placeholder="Search by email or name"
          aria-label="Search users"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      ) : null}

      {loading ? (
        <p className="help">Loading…</p>
      ) : activeTab === 'overview' ? (
        stats ? (
          <dl className={styles.stats}>
            <Stat label="Users" value={stats.totalUsers.toLocaleString()} />
            <Stat label="Active in the last 30 days" value={stats.activeUsers.toLocaleString()} />
            <Stat label="Revenue" value={formatCurrency(stats.totalRevenue)} />
            <Stat label="Active subscriptions" value={stats.activeSubscriptions.toLocaleString()} />
            <Stat label="Open support tickets" value={stats.openTickets.toString()} />
            <Stat label="Open fraud flags" value={stats.openFraudFlags.toString()} />
          </dl>
        ) : null
      ) : activeTab === 'users' ? (
        <Table empty="No users match." headers={['User', 'Joined', 'Subscription', ...(canManage ? [''] : [])]}>
          {users.map((user) => (
            <tr key={user.id}>
              <td>
                <span className={styles.personName}>{user.full_name || user.email}</span>
                {user.full_name ? <span className={styles.personEmail}>{user.email}</span> : null}
              </td>
              <td className={styles.muted}>{formatDate(user.created_at)}</td>
              <td>{user.subscription ? <Badge value={user.subscription.status} /> : <span className={styles.muted}>Free</span>}</td>
              {canManage ? (
                <td className={styles.actions}>
                  <button
                    type="button"
                    className="button buttonGhost"
                    onClick={() => act('/api/admin/users', 'set_admin', { user_id: user.id, role: 'admin' }, `Make ${user.email} an admin?`)}
                  >
                    Make admin
                  </button>
                  <button
                    type="button"
                    className="button buttonDanger"
                    onClick={() => act('/api/admin/users', 'suspend_user', { user_id: user.id }, `Suspend ${user.email}? They won't be able to sign in.`)}
                  >
                    Suspend
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      ) : activeTab === 'subscriptions' ? (
        <Table empty="No subscriptions yet." headers={['User', 'Status', 'Price', 'Renews', ...(canManage ? [''] : [])]}>
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
                      onClick={() => act('/api/admin/subscriptions', 'cancel', { subscription_id: sub.id }, `Cancel ${sub.email}'s subscription?`)}
                    >
                      Cancel
                    </button>
                  ) : (
                    <button type="button" className="button" onClick={() => act('/api/admin/subscriptions', 'resume', { subscription_id: sub.id })}>
                      Resume
                    </button>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      ) : activeTab === 'fraud' ? (
        <Table empty="No open fraud flags." headers={['User', 'Type', 'Severity', 'What happened', 'Date', ...(canManage ? [''] : [])]}>
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
                    Resolve
                  </button>
                  <button type="button" className="button buttonGhost" onClick={() => act('/api/admin/fraud', 'escalate', { flag_id: flag.id })}>
                    Escalate
                  </button>
                  <button
                    type="button"
                    className="button buttonDanger"
                    onClick={() =>
                      act(
                        '/api/admin/fraud',
                        'suspend_user',
                        { flag_id: flag.id, description: 'Suspended due to fraud' },
                        `Suspend ${flag.user_email}? They won't be able to sign in.`,
                      )
                    }
                  >
                    Suspend
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      ) : (
        <Table empty="No open tickets." headers={['From', 'Subject', 'Category', 'Priority', 'Status', 'Date', '']}>
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
                <button
                  type="button"
                  className="button buttonGhost"
                  onClick={() => act('/api/admin/tickets', 'update_status', { ticket_id: ticket.id, data: { status: 'in_progress' } })}
                >
                  Start
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => act('/api/admin/tickets', 'update_status', { ticket_id: ticket.id, data: { status: 'resolved' } })}
                >
                  Resolve
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
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
  if (props.children.length === 0) return <p className={`card ${styles.note}`}>{props.empty}</p>;
  return (
    <div className={`card ${styles.tableCard}`}>
      <table className={styles.table}>
        <thead>
          <tr>
            {props.headers.map((header, i) => (
              <th key={i} scope="col" aria-label={header ? undefined : 'Actions'}>
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
