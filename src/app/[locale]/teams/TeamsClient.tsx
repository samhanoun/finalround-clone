'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';
import type { Organization, OrganizationMember, OrganizationInvitation, OrganizationRole } from '@/lib/organizations';
import styles from './TeamsClient.module.css';

interface TeamsClientProps {
  initialOrganization: Organization | null;
  role: OrganizationRole | null;
}

type TabType = 'members' | 'invitations' | 'settings' | 'sso';

const TABS: Array<{ id: TabType; label: string }> = [
  { id: 'members', label: 'Members' },
  { id: 'invitations', label: 'Invitations' },
  { id: 'settings', label: 'Settings' },
  { id: 'sso', label: 'Single sign-on' },
];

const PLAN_LABEL: Record<string, string> = { free: 'Free', team: 'Team', enterprise: 'Enterprise' };
const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' };

export default function TeamsClient({ initialOrganization, role }: TeamsClientProps) {
  const [activeTab, setActiveTab] = useState<TabType>('members');
  const [organization, setOrganization] = useState<Organization | null>(initialOrganization);
  const [myRole, setMyRole] = useState<OrganizationRole | null>(role);
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
  const [error, setError] = useState<string | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // The first load shows "Loading…" (loading starts true); reloads after an action refresh in place.
  const loadData = useCallback(async (org: Organization) => {
    try {
      const [membersRes, statsRes] = await Promise.all([
        fetch(`/api/teams/${org.id}/members`),
        fetch(`/api/teams/${org.id}/analytics`),
      ]);
      const membersData = await membersRes.json().catch(() => ({}));
      const statsData = await statsRes.json().catch(() => ({}));
      if (membersData.members) setMembers(membersData.members);
      if (statsData.stats) setStats(statsData.stats);
    } catch {
      setError("The team didn't load. Reload the page to try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadInvitations = useCallback(async (org: Organization) => {
    try {
      const res = await fetch(`/api/teams/${org.id}/invitations`);
      const data = await res.json().catch(() => ({}));
      if (data.invitations) setInvitations(data.invitations);
    } catch {
      setError("Invitations didn't load. Try again.");
    }
  }, []);

  useEffect(() => {
    if (organization) {
      void (async () => {
        await loadData(organization);
      })();
      return;
    }
    // No team passed from the server: look for one the user belongs to.
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        const { data: memberships } = await supabase
          .from('organization_members')
          .select('organization_id, role, organizations(*)')
          .eq('user_id', user.id)
          .eq('status', 'active');
        if (!cancelled && memberships && memberships.length > 0) {
          setOrganization(memberships[0].organizations as unknown as Organization);
          setMyRole(memberships[0].role as OrganizationRole);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organization, loadData]);

  async function call(url: string, init: RequestInit, failure: string) {
    setError(null);
    try {
      const res = await fetch(url, init);
      if (!res.ok) throw new Error();
      return res;
    } catch {
      setError(failure);
      return null;
    }
  }

  async function handleInvite(email: string, inviteRole: string) {
    if (!organization) return;
    const res = await call(
      `/api/teams/${organization.id}/invitations`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, role: inviteRole }) },
      "The invitation wasn't sent. Check the address and try again.",
    );
    if (!res) return;
    setShowInviteModal(false);
    void loadInvitations(organization);
    void loadData(organization);
  }

  async function handleCancelInvitation(invitationId: string) {
    if (!organization) return;
    const res = await call(
      `/api/teams/${organization.id}/invitations?invitation_id=${invitationId}`,
      { method: 'DELETE' },
      "The invitation wasn't cancelled. Try again.",
    );
    if (!res) return;
    void loadInvitations(organization);
    void loadData(organization);
  }

  async function handleRemoveMember(memberId: string) {
    if (!organization) return;
    const res = await call(
      `/api/teams/${organization.id}/members`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ member_id: memberId, action: 'remove' }) },
      "That member wasn't removed. Try again.",
    );
    if (res) void loadData(organization);
  }

  async function handleUpdateRole(memberId: string, newRole: string) {
    if (!organization) return;
    const res = await call(
      `/api/teams/${organization.id}/members`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId, action: 'update_role', role: newRole }),
      },
      "The role wasn't changed. Try again.",
    );
    if (res) void loadData(organization);
  }

  async function handleCreateTeam(name: string, slug: string) {
    const res = await call(
      '/api/teams',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, slug }) },
      "The team wasn't created. That address may be taken; try another.",
    );
    if (!res) return;
    const data = await res.json();
    setOrganization(data.organization);
    setMyRole('owner');
    setShowCreateModal(false);
  }

  async function handleRename(name: string) {
    if (!organization) return false;
    const res = await call(
      `/api/teams/${organization.id}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) },
      "The name wasn't saved. Try again.",
    );
    if (!res) return false;
    const data = await res.json();
    if (data.organization) setOrganization(data.organization);
    return true;
  }

  if (loading && !organization) {
    return <p className="help">Loading your team…</p>;
  }

  if (!organization) {
    return (
      <>
        <section className={`card ${styles.empty}`}>
          <div className="cardInner stack">
            <h2 className="cardTitle">Practise together</h2>
            <p className="cardDesc">
              Create a team to invite colleagues or classmates, see who is practising, and manage access in one place.
            </p>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            <div>
              <button type="button" className="button buttonPrimary" onClick={() => setShowCreateModal(true)}>
                Create a team
              </button>
            </div>
          </div>
        </section>
        {showCreateModal ? <CreateTeamModal onClose={() => setShowCreateModal(false)} onCreate={handleCreateTeam} /> : null}
      </>
    );
  }

  const canManage = myRole === 'owner' || myRole === 'admin';

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.teamName}>{organization.name}</h2>
          <div className={styles.badges}>
            <span className="badge">{PLAN_LABEL[organization.plan] ?? organization.plan} plan</span>
            {myRole ? <span className="badge badgeIce">You are {ROLE_LABEL[myRole]?.toLowerCase() ?? myRole}</span> : null}
          </div>
        </div>
        {canManage ? (
          <button type="button" className="button buttonPrimary" onClick={() => setShowInviteModal(true)}>
            Invite someone
          </button>
        ) : null}
      </header>

      <dl className={styles.stats}>
        <Stat label="Members" value={stats.totalMembers} />
        <Stat label="Active" value={stats.activeMembers} />
        <Stat label="Interviews" value={stats.totalInterviews} />
        <Stat label="This month" value={stats.interviewsThisMonth} />
      </dl>

      <nav className={styles.tabs} aria-label="Team sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={styles.tab}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            onClick={() => {
              setActiveTab(tab.id);
              if (tab.id === 'invitations') void loadInvitations(organization);
            }}
          >
            {tab.label}
            {tab.id === 'invitations' && stats.pendingInvitations ? <span className={styles.count}>{stats.pendingInvitations}</span> : null}
          </button>
        ))}
      </nav>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {loading ? (
        <p className="help">Loading…</p>
      ) : activeTab === 'members' ? (
        <MembersTab members={members} canManage={canManage} onRemove={handleRemoveMember} onUpdateRole={handleUpdateRole} />
      ) : activeTab === 'invitations' ? (
        <InvitationsTab invitations={invitations} canManage={canManage} onCancel={handleCancelInvitation} onInvite={() => setShowInviteModal(true)} />
      ) : activeTab === 'settings' ? (
        <SettingsTab organization={organization} canEdit={myRole === 'owner'} onRename={handleRename} />
      ) : (
        <SSOTab organization={organization} canEdit={myRole === 'owner'} />
      )}

      {showInviteModal ? <InviteModal onClose={() => setShowInviteModal(false)} onInvite={handleInvite} /> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function initials(member: OrganizationMember) {
  return (member.user_full_name?.[0] || member.user_email?.[0] || '?').toUpperCase();
}

function MembersTab({
  members,
  canManage,
  onRemove,
  onUpdateRole,
}: {
  members: OrganizationMember[];
  canManage: boolean;
  onRemove: (id: string) => void;
  onUpdateRole: (id: string, role: string) => void;
}) {
  if (members.length === 0) {
    return <p className={`card ${styles.note}`}>No members yet. Invite someone to get started.</p>;
  }
  return (
    <div className={`card ${styles.tableCard}`}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Role</th>
            <th scope="col">Status</th>
            <th scope="col">Joined</th>
            {canManage ? <th scope="col" aria-label="Actions" /> : null}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id}>
              <td>
                <div className={styles.person}>
                  <span className={styles.avatar} aria-hidden="true">
                    {initials(member)}
                  </span>
                  <span>
                    <span className={styles.personName}>{member.user_full_name || member.user_email || 'Unknown'}</span>
                    {member.user_full_name ? <span className={styles.personEmail}>{member.user_email}</span> : null}
                  </span>
                </div>
              </td>
              <td>
                {canManage && member.role !== 'owner' ? (
                  <select
                    className={`select ${styles.roleSelect}`}
                    value={member.role}
                    aria-label={`Role for ${member.user_email ?? 'member'}`}
                    onChange={(e) => onUpdateRole(member.id, e.target.value)}
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                ) : (
                  <span className="badge">{ROLE_LABEL[member.role] ?? member.role}</span>
                )}
              </td>
              <td>
                <span className={`badge ${member.status === 'active' ? 'badgeLive' : ''}`}>{member.status}</span>
              </td>
              <td className={styles.muted}>{member.joined_at ? new Date(member.joined_at).toLocaleDateString() : '—'}</td>
              {canManage ? (
                <td className={styles.actionsCell}>
                  {member.role !== 'owner' ? (
                    <button type="button" className="button buttonGhost" onClick={() => onRemove(member.id)}>
                      Remove
                    </button>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
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
  if (invitations.length === 0) {
    return (
      <div className={`card ${styles.note}`}>
        <p>No invitations waiting.</p>
        {canManage ? (
          <button type="button" className="button" onClick={onInvite}>
            Invite someone
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className={`card ${styles.tableCard}`}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
            <th scope="col">Status</th>
            <th scope="col">Expires</th>
            {canManage ? <th scope="col" aria-label="Actions" /> : null}
          </tr>
        </thead>
        <tbody>
          {invitations.map((inv) => (
            <tr key={inv.id}>
              <td>{inv.email}</td>
              <td>{ROLE_LABEL[inv.role] ?? inv.role}</td>
              <td>
                <span className="badge">{inv.status}</span>
              </td>
              <td className={styles.muted}>{new Date(inv.expires_at).toLocaleDateString()}</td>
              {canManage ? (
                <td className={styles.actionsCell}>
                  <button type="button" className="button buttonGhost" onClick={() => onCancel(inv.id)}>
                    Cancel
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SettingsTab({
  organization,
  canEdit,
  onRename,
}: {
  organization: Organization;
  canEdit: boolean;
  onRename: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(organization.name);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const nameId = useId();

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    const ok = await onRename(name.trim());
    setSaving(false);
    setSaved(ok);
  }

  return (
    <form className="card" onSubmit={save}>
      <div className="cardInner stack">
        <h3 className="cardTitle">Team details</h3>
        <label className="label" htmlFor={nameId}>
          Team name
          <input
            id={nameId}
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
            maxLength={100}
          />
        </label>
        <div className={styles.readOnly}>
          <span>Team address</span>
          <code>{organization.slug}</code>
        </div>
        <div className={styles.readOnly}>
          <span>Plan</span>
          <span>{PLAN_LABEL[organization.plan] ?? organization.plan}</span>
        </div>
        {canEdit ? (
          <div className={styles.formActions}>
            {saved ? <span className={styles.saved}>Saved</span> : null}
            <button type="submit" className="button buttonPrimary" disabled={saving || !name.trim() || name.trim() === organization.name}>
              {saving ? 'Saving…' : 'Save name'}
            </button>
          </div>
        ) : (
          <p className="help">Only the team owner can change these.</p>
        )}
      </div>
    </form>
  );
}

function SSOTab({ organization, canEdit }: { organization: Organization; canEdit: boolean }) {
  const [ssoEnabled, setSsoEnabled] = useState(organization.sso_enabled);
  const [busy, setBusy] = useState(false);
  const entityId = typeof window !== 'undefined' ? `${window.location.origin}/saml/metadata/${organization.id}` : '';

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch(`/api/teams/${organization.id}/sso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: ssoEnabled ? 'disable' : 'enable', provider: 'saml' }),
      });
      if (res.ok) setSsoEnabled(!ssoEnabled);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="cardInner stack">
        <div className={styles.ssoRow}>
          <div>
            <h3 className="cardTitle">SAML sign-in</h3>
            <p className="help">Let members sign in through your company’s identity provider.</p>
          </div>
          {canEdit ? (
            <button
              type="button"
              role="switch"
              aria-checked={ssoEnabled}
              aria-label="SAML sign-in"
              className={styles.switch}
              onClick={toggle}
              disabled={busy}
            >
              <span />
            </button>
          ) : (
            <span className={`badge ${ssoEnabled ? 'badgeLive' : ''}`}>{ssoEnabled ? 'On' : 'Off'}</span>
          )}
        </div>
        {ssoEnabled ? (
          <div className={styles.readOnly}>
            <span>Service provider entity ID</span>
            <code>{entityId}</code>
          </div>
        ) : null}
        <p className="help">Sign-in with Google, Microsoft or Okta (OIDC) isn’t available yet.</p>
      </div>
    </div>
  );
}

function Modal(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);
  return (
    <div className={styles.backdrop} onClick={props.onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <h3 id={titleId} className="cardTitle">
          {props.title}
        </h3>
        {props.children}
      </div>
    </div>
  );
}

function InviteModal({ onClose, onInvite }: { onClose: () => void; onInvite: (email: string, role: string) => void }) {
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const ids = { email: useId(), role: useId() };
  return (
    <Modal title="Invite someone" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          onInvite(email.trim(), inviteRole);
        }}
      >
        <label className="label" htmlFor={ids.email}>
          Email
          <input
            id={ids.email}
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@company.com"
            required
            autoFocus
          />
        </label>
        <label className="label" htmlFor={ids.role}>
          Role
          <select id={ids.role} className="select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            <option value="member">Member</option>
            <option value="admin">Admin (can manage members)</option>
            <option value="viewer">Viewer (read-only)</option>
          </select>
        </label>
        <div className={styles.formActions}>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button buttonPrimary" disabled={!email.trim()}>
            Send invitation
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CreateTeamModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, slug: string) => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const ids = { name: useId(), slug: useId() };
  const toSlug = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

  return (
    <Modal title="Create a team" onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          onCreate(name.trim(), slug);
        }}
      >
        <label className="label" htmlFor={ids.name}>
          Team name
          <input
            id={ids.name}
            className="input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugEdited) setSlug(toSlug(e.target.value));
            }}
            placeholder="e.g. Acme engineering"
            required
            autoFocus
            maxLength={100}
          />
        </label>
        <label className="label" htmlFor={ids.slug}>
          Team address
          <input
            id={ids.slug}
            className="input"
            value={slug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(toSlug(e.target.value));
            }}
            placeholder="acme-engineering"
            required
          />
          <span className="help">Lowercase letters, numbers and dashes.</span>
        </label>
        <div className={styles.formActions}>
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button buttonPrimary" disabled={!name.trim() || !slug}>
            Create team
          </button>
        </div>
      </form>
    </Modal>
  );
}
