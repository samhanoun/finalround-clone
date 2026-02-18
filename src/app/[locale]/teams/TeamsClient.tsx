'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import type { Organization, OrganizationMember, OrganizationInvitation, OrganizationRole } from '@/lib/organizations';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface TeamsClientProps {
  userId: string;
  initialOrganization: Organization | null;
  role: OrganizationRole | null;
}

type TabType = 'members' | 'invitations' | 'analytics' | 'settings' | 'sso';

export default function TeamsClient({ userId, initialOrganization, role }: TeamsClientProps) {
  const [activeTab, setActiveTab] = useState<TabType>('members');
  const [organization, setOrganization] = useState<Organization | null>(initialOrganization);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [stats, setStats] = useState({
    totalMembers: 0,
    activeMembers: 0,
    pendingInvitations: 0,
    totalInterviews: 0,
    interviewsThisMonth: 0,
  });
  const [loading, setLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    if (organization) {
      loadData();
    } else {
      loadOrganizations();
    }
  }, [organization]);

  async function loadOrganizations() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: memberships } = await supabase
        .from('organization_members')
        .select('organization_id, role, organizations(*)')
        .eq('user_id', user.id)
        .eq('status', 'active');

      if (memberships && memberships.length > 0) {
        const org = memberships[0].organizations as unknown as Organization;
        setOrganization(org);
      }
    } catch (error) {
      console.error('Error loading organizations:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadData() {
    if (!organization) return;
    setLoading(true);

    try {
      const [membersRes, statsRes] = await Promise.all([
        fetch(`/api/teams/${organization.id}/members`),
        fetch(`/api/teams/${organization.id}/analytics`),
      ]);

      const membersData = await membersRes.json();
      const statsData = await statsRes.json();

      if (membersData.members) setMembers(membersData.members);
      if (statsData.stats) setStats(statsData.stats);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadInvitations() {
    if (!organization) return;
    try {
      const res = await fetch(`/api/teams/${organization.id}/invitations`);
      const data = await res.json();
      if (data.invitations) setInvitations(data.invitations);
    } catch (error) {
      console.error('Error loading invitations:', error);
    }
  }

  async function handleInvite(email: string, role: string) {
    if (!organization) return;
    try {
      const res = await fetch(`/api/teams/${organization.id}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });

      if (res.ok) {
        setShowInviteModal(false);
        loadInvitations();
        loadData();
      }
    } catch (error) {
      console.error('Error inviting:', error);
    }
  }

  async function handleCancelInvitation(invitationId: string) {
    if (!organization) return;
    try {
      const res = await fetch(
        `/api/teams/${organization.id}/invitations?invitation_id=${invitationId}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        loadInvitations();
        loadData();
      }
    } catch (error) {
      console.error('Error cancelling invitation:', error);
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!organization) return;
    try {
      const res = await fetch(`/api/teams/${organization.id}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId, action: 'remove' }),
      });
      if (res.ok) loadData();
    } catch (error) {
      console.error('Error removing member:', error);
    }
  }

  async function handleUpdateRole(memberId: string, newRole: string) {
    if (!organization) return;
    try {
      const res = await fetch(`/api/teams/${organization.id}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId, action: 'update_role', role: newRole }),
      });
      if (res.ok) loadData();
    } catch (error) {
      console.error('Error updating role:', error);
    }
  }

  async function handleCreateTeam(name: string, slug: string) {
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug }),
      });

      if (res.ok) {
        const data = await res.json();
        setOrganization(data.organization);
        setShowCreateModal(false);
      }
    } catch (error) {
      console.error('Error creating team:', error);
    }
  }

  if (loading && !organization) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Welcome to Teams</h1>
          <p className="text-gray-600 mb-8">
            Create a team to collaborate with your colleagues and track your team&apos;s progress.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Create Your First Team
          </button>
        </div>

        {showCreateModal && (
          <CreateTeamModal
            onClose={() => setShowCreateModal(false)}
            onCreate={handleCreateTeam}
          />
        )}
      </div>
    );
  }

  const canManage = role === 'owner' || role === 'admin';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{organization.name}</h1>
              <p className="text-gray-500 mt-1">
                {organization.plan === 'enterprise' ? 'Enterprise' : organization.plan === 'team' ? 'Team' : 'Free'} Plan
                {role && <span> • Your role: {role}</span>}
              </p>
            </div>
            <div className="flex gap-2">
              {canManage && (
                <button
                  onClick={() => { setActiveTab('invitations'); loadInvitations(); }}
                  className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Invitations ({stats.pendingInvitations})
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Total Members" value={stats.totalMembers} />
          <StatCard label="Active Members" value={stats.activeMembers} />
          <StatCard label="Total Interviews" value={stats.totalInterviews} />
          <StatCard label="This Month" value={stats.interviewsThisMonth} />
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex gap-8">
            {(['members', 'invitations', 'analytics', 'settings', 'sso'] as TabType[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <>
            {activeTab === 'members' && (
              <MembersTab
                members={members}
                canManage={canManage}
                onRemove={handleRemoveMember}
                onUpdateRole={handleUpdateRole}
                onInvite={() => setShowInviteModal(true)}
              />
            )}
            {activeTab === 'invitations' && (
              <InvitationsTab
                invitations={invitations}
                canManage={canManage}
                onCancel={handleCancelInvitation}
                onInvite={() => setShowInviteModal(true)}
              />
            )}
            {activeTab === 'analytics' && (
              <AnalyticsTab stats={stats} />
            )}
            {activeTab === 'settings' && (
              <SettingsTab organization={organization} role={role} />
            )}
            {activeTab === 'sso' && (
              <SSOTab organization={organization} role={role} />
            )}
          </>
        )}
      </div>

      {showInviteModal && (
        <InviteModal
          onClose={() => setShowInviteModal(false)}
          onInvite={handleInvite}
        />
      )}
    </div>
  );
}

// Sub-components
function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  );
}

function MembersTab({
  members,
  canManage,
  onRemove,
  onUpdateRole,
  onInvite,
}: {
  members: OrganizationMember[];
  canManage: boolean;
  onRemove: (id: string) => void;
  onUpdateRole: (id: string, role: string) => void;
  onInvite: () => void;
}) {
  return (
    <div>
      <div className="flex justify-end mb-4">
        {canManage && (
          <button
            onClick={onInvite}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Invite Member
          </button>
        )}
      </div>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Member
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Role
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Joined
              </th>
              {canManage && <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {members.map((member) => (
              <tr key={member.id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="h-10 w-10 rounded-full bg-gray-300 flex items-center justify-center">
                      <span className="text-gray-600 font-medium">
                        {member.user_full_name?.[0] || member.user_email?.[0] || '?'}
                      </span>
                    </div>
                    <div className="ml-4">
                      <div className="text-sm font-medium text-gray-900">
                        {member.user_full_name || 'Unknown'}
                      </div>
                      <div className="text-sm text-gray-500">{member.user_email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {canManage && member.role !== 'owner' ? (
                    <select
                      value={member.role}
                      onChange={(e) => onUpdateRole(member.id, e.target.value)}
                      className="text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  ) : (
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                      {member.role}
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    member.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {member.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {member.joined_at ? new Date(member.joined_at).toLocaleDateString() : '-'}
                </td>
                {canManage && (
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    {member.role !== 'owner' && (
                      <button
                        onClick={() => onRemove(member.id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InvitationsTab({
  invitations,
  canManage,
  onCancel,
  onInvite,
}: {
  invitations: OrganizationInvitation[];
  canManage: boolean;
  onCancel: (id: string) => void;
  onInvite: () => void;
}) {
  return (
    <div>
      <div className="flex justify-end mb-4">
        {canManage && (
          <button
            onClick={onInvite}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Send Invitation
          </button>
        )}
      </div>
      {invitations.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500">No pending invitations</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Expires
                </th>
                {canManage && <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {invitations.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {inv.email}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {inv.role}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(inv.expires_at).toLocaleDateString()}
                  </td>
                  {canManage && (
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => onCancel(inv.id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        Cancel
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AnalyticsTab({ stats }: { stats: Record<string, number> }) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-4">Team Analytics</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <div>
          <p className="text-sm text-gray-500">Total Members</p>
          <p className="text-3xl font-bold text-gray-900">{stats.totalMembers}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Active Members</p>
          <p className="text-3xl font-bold text-green-600">{stats.activeMembers}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Total Interviews</p>
          <p className="text-3xl font-bold text-blue-600">{stats.totalInterviews}</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">This Month</p>
          <p className="text-3xl font-bold text-purple-600">{stats.interviewsThisMonth}</p>
        </div>
      </div>
    </div>
  );
}

function SettingsTab({ organization, role }: { organization: Organization; role: string | null }) {
  const canEdit = role === 'owner';

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-4">Team Settings</h2>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Team Name</label>
          <input
            type="text"
            defaultValue={organization.name}
            disabled={!canEdit}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Team Slug</label>
          <input
            type="text"
            defaultValue={organization.slug}
            disabled={!canEdit}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Plan</label>
          <select
            defaultValue={organization.plan}
            disabled={!canEdit}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100"
          >
            <option value="free">Free</option>
            <option value="team">Team</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function SSOTab({ organization, role }: { organization: Organization; role: string | null }) {
  const canEdit = role === 'owner';
  const [ssoEnabled, setSsoEnabled] = useState(organization.sso_enabled);

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-4">Single Sign-On (SSO)</h2>
      
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">SAML Authentication</p>
            <p className="text-sm text-gray-500">
              Allow team members to sign in with SAML
            </p>
          </div>
          {canEdit ? (
            <button
              onClick={async () => {
                const res = await fetch(`/api/teams/${organization.id}/sso`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: ssoEnabled ? 'disable' : 'enable', provider: 'saml' }),
                });
                if (res.ok) setSsoEnabled(!ssoEnabled);
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                ssoEnabled ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  ssoEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          ) : (
            <span className={`px-2 py-1 rounded text-sm ${ssoEnabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
              {ssoEnabled ? 'Enabled' : 'Disabled'}
            </span>
          )}
        </div>

        {ssoEnabled && (
          <div className="border-t pt-4">
            <p className="font-medium mb-2">SAML Configuration</p>
            <p className="text-sm text-gray-500 mb-4">
              Configure your Identity Provider (IdP) to enable SAML authentication.
            </p>
            <div className="bg-gray-50 rounded p-4 text-sm font-mono">
              <p className="mb-2">Service Provider (SP) Metadata:</p>
              <code className="text-xs">
                Entity ID: {typeof window !== 'undefined' ? window.location.origin : ''}/saml/metadata/{organization.id}
              </code>
            </div>
          </div>
        )}

        <div className="border-t pt-4">
          <p className="font-medium">OIDC / OAuth 2.0</p>
          <p className="text-sm text-gray-500">
            Coming soon - Connect with OAuth providers like Google, Microsoft, Okta
          </p>
        </div>
      </div>
    </div>
  );
}

function InviteModal({ onClose, onInvite }: { onClose: () => void; onInvite: (email: string, role: string) => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-4">Invite Team Member</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="colleague@company.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onInvite(email, role)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Send Invite
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateTeamModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, slug: string) => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  const handleSlugChange = (value: string) => {
    setSlug(value.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-4">Create New Team</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Team Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="My Company"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Team URL Slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="my-company"
            />
            <p className="text-xs text-gray-500 mt-1">This will be your team&apos;s URL: /teams/{slug}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onCreate(name, slug)}
            disabled={!name || !slug}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            Create Team
          </button>
        </div>
      </div>
    </div>
  );
}
