'use client';

import { useState, useEffect, useCallback } from 'react';

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
  subscription: {
    status: string;
    current_period_end: string;
  } | null;
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

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [fraudFlags, setFraudFlags] = useState<FraudFlag[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [page] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'overview') {
        const res = await fetch('/api/admin/analytics?period=30d');
        const data = await res.json();
        if (data.totals) {
          setStats({
            totalUsers: data.totals.totalUsers || 0,
            activeUsers: data.totals.activeUsers || 0,
            totalRevenue: data.totals.totalRevenue || 0,
            activeSubscriptions: data.totals.activeSubscriptions || 0,
            openTickets: data.totals.ticketsOpened || 0,
            openFraudFlags: data.totals.fraudFlags || 0
          });
        }
      } else if (activeTab === 'users') {
        const res = await fetch(`/api/admin/users?page=${page}&limit=20&search=${searchQuery}`);
        const data = await res.json();
        setUsers(data.users || []);
      } else if (activeTab === 'subscriptions') {
        const res = await fetch(`/api/admin/subscriptions?page=${page}&limit=20`);
        const data = await res.json();
        setSubscriptions(data.subscriptions || []);
      } else if (activeTab === 'fraud') {
        const res = await fetch(`/api/admin/fraud?page=${page}&limit=20&resolved=false`);
        const data = await res.json();
        setFraudFlags(data.flags || []);
      } else if (activeTab === 'tickets') {
        const res = await fetch(`/api/admin/tickets?page=${page}&limit=20&status=open`);
        const data = await res.json();
        setTickets(data.tickets || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, [activeTab, page, searchQuery]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAction = async (endpoint: string, action: string, data?: Record<string, unknown>) => {
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...data })
      });
      if (res.ok) {
        fetchData();
      }
    } catch (error) {
      console.error('Action error:', error);
    }
  };

  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-600';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      default: return 'bg-gray-400';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500';
      case 'canceled': return 'bg-red-500';
      case 'past_due': return 'bg-yellow-500';
      default: return 'bg-gray-400';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-600';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      default: return 'bg-gray-400';
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'users', label: 'Users' },
    { id: 'subscriptions', label: 'Subscriptions' },
    { id: 'fraud', label: 'Fraud Detection' },
    { id: 'tickets', label: 'Support Tickets' }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">Manage users, subscriptions, and monitor platform health</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="-mb-px flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
                {tab.id === 'tickets' && stats?.openTickets ? (
                  <span className="ml-2 bg-blue-100 text-blue-600 py-0.5 px-2 rounded-full text-xs">
                    {stats.openTickets}
                  </span>
                ) : null}
                {tab.id === 'fraud' && stats?.openFraudFlags ? (
                  <span className="ml-2 bg-red-100 text-red-600 py-0.5 px-2 rounded-full text-xs">
                    {stats.openFraudFlags}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <>
            {/* Overview Tab */}
            {activeTab === 'overview' && stats && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <StatCard 
                  title="Total Users" 
                  value={stats.totalUsers.toLocaleString()} 
                  icon="👥"
                />
                <StatCard 
                  title="Active Users (30d)" 
                  value={stats.activeUsers.toLocaleString()} 
                  icon="📈"
                />
                <StatCard 
                  title="Total Revenue" 
                  value={formatCurrency(stats.totalRevenue)} 
                  icon="💰"
                />
                <StatCard 
                  title="Active Subscriptions" 
                  value={stats.activeSubscriptions.toLocaleString()} 
                  icon="📦"
                />
                <StatCard 
                  title="Open Support Tickets" 
                  value={stats.openTickets.toString()} 
                  icon="🎫"
                />
                <StatCard 
                  title="Open Fraud Flags" 
                  value={stats.openFraudFlags.toString()} 
                  icon="🚨"
                />
              </div>
            )}

            {/* Users Tab */}
            {activeTab === 'users' && (
              <div>
                <div className="mb-4 flex gap-4">
                  <input
                    type="text"
                    placeholder="Search users..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="bg-white shadow rounded-lg overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Joined</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Subscription</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {users.map((user) => (
                        <tr key={user.id}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="h-10 w-10 rounded-full bg-gray-300 flex items-center justify-center">
                                {user.avatar_url ? (
                                  <img src={user.avatar_url} alt="" className="h-10 w-10 rounded-full" />
                                ) : (
                                  <span className="text-gray-600 font-medium">
                                    {user.full_name?.[0] || user.email[0].toUpperCase()}
                                  </span>
                                )}
                              </div>
                              <div className="ml-4">
                                <div className="text-sm font-medium text-gray-900">{user.full_name || 'N/A'}</div>
                                <div className="text-sm text-gray-500">{user.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {formatDate(user.created_at)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {user.subscription ? (
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white ${getStatusColor(user.subscription.status)}`}>
                                {user.subscription.status}
                              </span>
                            ) : (
                              <span className="text-gray-400 text-sm">Free</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <button
                              onClick={() => handleAction('/api/admin/users', 'suspend_user', { user_id: user.id })}
                              className="text-red-600 hover:text-red-900 mr-4"
                            >
                              Suspend
                            </button>
                            <button
                              onClick={() => handleAction('/api/admin/users', 'set_admin', { user_id: user.id, role: 'admin' })}
                              className="text-blue-600 hover:text-blue-900"
                            >
                              Make Admin
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Subscriptions Tab */}
            {activeTab === 'subscriptions' && (
              <div>
                <div className="bg-white shadow rounded-lg overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Plan</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Renews</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {subscriptions.map((sub) => (
                        <tr key={sub.id}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {sub.email}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white ${getStatusColor(sub.status)}`}>
                              {sub.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {sub.price_id === 'price_pro' ? 'Pro' : sub.price_id === 'price_enterprise' ? 'Enterprise' : 'Unknown'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {sub.current_period_end ? formatDate(sub.current_period_end) : 'N/A'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            {sub.status === 'active' ? (
                              <button
                                onClick={() => handleAction('/api/admin/subscriptions', 'cancel', { subscription_id: sub.id })}
                                className="text-red-600 hover:text-red-900"
                              >
                                Cancel
                              </button>
                            ) : (
                              <button
                                onClick={() => handleAction('/api/admin/subscriptions', 'resume', { subscription_id: sub.id })}
                                className="text-green-600 hover:text-green-900"
                              >
                                Resume
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Fraud Tab */}
            {activeTab === 'fraud' && (
              <div>
                <div className="bg-white shadow rounded-lg overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Severity</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {fraudFlags.map((flag) => (
                        <tr key={flag.id} className={flag.resolved ? 'opacity-50' : ''}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {flag.user_email}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {flag.flag_type}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white ${getSeverityColor(flag.severity)}`}>
                              {flag.severity}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                            {flag.description}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {formatDate(flag.created_at)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            {!flag.resolved && (
                              <>
                                <button
                                  onClick={() => handleAction('/api/admin/fraud', 'resolve', { flag_id: flag.id })}
                                  className="text-green-600 hover:text-green-900 mr-4"
                                >
                                  Resolve
                                </button>
                                <button
                                  onClick={() => handleAction('/api/admin/fraud', 'escalate', { flag_id: flag.id })}
                                  className="text-orange-600 hover:text-orange-900 mr-4"
                                >
                                  Escalate
                                </button>
                                <button
                                  onClick={() => handleAction('/api/admin/fraud', 'suspend_user', { flag_id: flag.id, description: 'Suspended due to fraud' })}
                                  className="text-red-600 hover:text-red-900"
                                >
                                  Suspend User
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Tickets Tab */}
            {activeTab === 'tickets' && (
              <div>
                <div className="bg-white shadow rounded-lg overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Subject</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {tickets.map((ticket) => (
                        <tr key={ticket.id}>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{ticket.full_name || 'N/A'}</div>
                            <div className="text-sm text-gray-500">{ticket.email}</div>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">
                            {ticket.subject}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {ticket.category}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white ${getPriorityColor(ticket.priority)}`}>
                              {ticket.priority}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              ticket.status === 'open' ? 'bg-blue-100 text-blue-800' :
                              ticket.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                              ticket.status === 'resolved' ? 'bg-green-100 text-green-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {ticket.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {formatDate(ticket.created_at)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <button
                              onClick={() => handleAction('/api/admin/tickets', 'update_status', { ticket_id: ticket.id, data: { status: 'in_progress' } })}
                              className="text-blue-600 hover:text-blue-900 mr-4"
                            >
                              Start
                            </button>
                            <button
                              onClick={() => handleAction('/api/admin/tickets', 'update_status', { ticket_id: ticket.id, data: { status: 'resolved' } })}
                              className="text-green-600 hover:text-green-900"
                            >
                              Resolve
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, value, icon }: { title: string; value: string; icon: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center">
        <div className="flex-shrink-0 text-3xl">{icon}</div>
        <div className="ml-5 w-0 flex-1">
          <dl>
            <dt className="text-sm font-medium text-gray-500 truncate">{title}</dt>
            <dd className="text-2xl font-semibold text-gray-900">{value}</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}
