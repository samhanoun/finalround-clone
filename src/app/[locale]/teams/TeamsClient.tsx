'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from '@/i18n/routing';
import { useFormatter, useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/browser';
import type { Organization, OrganizationMember, OrganizationInvitation, OrganizationRole } from '@/lib/organizations';
import styles from './TeamsClient.module.css';

interface TeamsClientProps {
  initialOrganization: Organization | null;
  role: OrganizationRole | null;
}

type TabType = 'members' | 'invitations' | 'settings' | 'sso';

const TABS: TabType[] = ['members', 'invitations', 'settings', 'sso'];

type T = ReturnType<typeof useTranslations>;

/** A stored value (plan, role, status) in the user's language when the messages know it. */
function label(t: T, group: string, value: string) {
  return t.has(`${group}.${value}`) ? t(`${group}.${value}`) : value;
}

type TeamInvitation = OrganizationInvitation & { invitePath?: string };
type InviteForMe = { teamName: string; role: string; expiresAt: string; invitePath: string };
type InviteSent = { email: string; emailSent: boolean; link: string };

function absoluteLink(path: string) {
  return typeof window === 'undefined' ? path : `${window.location.origin}${path}`;
}
export default function TeamsClient({ initialOrganization, role }: TeamsClientProps) {
  const t = useTranslations('Teams');
  const [activeTab, setActiveTab] = useState<TabType>('members');
  const [organization, setOrganization] = useState<Organization | null>(initialOrganization);
  const [myRole, setMyRole] = useState<OrganizationRole | null>(role);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [invitesForMe, setInvitesForMe] = useState<InviteForMe[]>([]);
  const [inviteSent, setInviteSent] = useState<InviteSent | null>(null);
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
      setError(t('errors.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadInvitations = useCallback(async (org: Organization) => {
    try {
      const res = await fetch(`/api/teams/${org.id}/invitations`);
      const data = await res.json().catch(() => ({}));
      if (data.invitations) setInvitations(data.invitations);
    } catch {
      setError(t('errors.invitations'));
    }
  }, [t]);

  // Invitations sent to this user's address, from any team.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch('/api/teams/invitations').catch(() => null);
      const data = res?.ok ? await res.json().catch(() => null) : null;
      if (!cancelled && data?.invitations) setInvitesForMe(data.invitations);
    })();
    return () => {
      cancelled = true;
    };
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
    setError(null);
    const res = await fetch(`/api/teams/${organization.id}/invitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role: inviteRole }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) {
      setError(
        data?.error === 'already_member' ? t('errors.alreadyMember', { email }) : t('errors.invite'),
      );
      return;
    }
    setShowInviteModal(false);
    setInviteSent({ email, emailSent: Boolean(data.emailSent), link: absoluteLink(data.invitation.invitePath) });
    setActiveTab('invitations');
    void loadInvitations(organization);
    void loadData(organization);
  }

  async function handleCancelInvitation(invitationId: string) {
    if (!organization) return;
    const res = await call(
      `/api/teams/${organization.id}/invitations?invitation_id=${invitationId}`,
      { method: 'DELETE' },
      t('errors.cancel'),
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
      t('errors.remove'),
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
      t('errors.role'),
    );
    if (res) void loadData(organization);
  }

  async function handleCreateTeam(name: string, slug: string) {
    const res = await call(
      '/api/teams',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, slug }) },
      t('errors.create'),
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
      t('errors.rename'),
    );
    if (!res) return false;
    const data = await res.json();
    if (data.organization) setOrganization(data.organization);
    return true;
  }

  const forMe = invitesForMe.length ? <InvitesForMe invites={invitesForMe} /> : null;

  if (loading && !organization) {
    return <p className="help">{t('loadingTeam')}</p>;
  }

  if (!organization) {
    return (
      <>
        {forMe}
        <section className={`card ${styles.empty}`}>
          <div className="cardInner stack">
            <h2 className="cardTitle">{t('emptyTitle')}</h2>
            <p className="cardDesc">{t('emptyDesc')}</p>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            <div>
              <button type="button" className="button buttonPrimary" onClick={() => setShowCreateModal(true)}>
                {t('create')}
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
      {forMe}
      <header className={styles.header}>
        <div>
          <h2 className={styles.teamName}>{organization.name}</h2>
          <div className={styles.badges}>
            <span className="badge">{t('plan', { plan: label(t, 'plans', organization.plan) })}</span>
            {myRole ? <span className="badge badgeIce">{t('youAre', { role: label(t, 'roles', myRole) })}</span> : null}
          </div>
        </div>
        {canManage ? (
          <button type="button" className="button buttonPrimary" onClick={() => setShowInviteModal(true)}>
            {t('invite')}
          </button>
        ) : null}
      </header>

      <dl className={styles.stats}>
        <Stat label={t('stats.members')} value={stats.totalMembers} />
        <Stat label={t('stats.active')} value={stats.activeMembers} />
        <Stat label={t('stats.interviews')} value={stats.totalInterviews} />
        <Stat label={t('stats.thisMonth')} value={stats.interviewsThisMonth} />
      </dl>

      <nav className={styles.tabs} aria-label={t('sections')}>
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={styles.tab}
            aria-current={activeTab === tab ? 'page' : undefined}
            onClick={() => {
              setActiveTab(tab);
              if (tab === 'invitations') void loadInvitations(organization);
            }}
          >
            {t(`tabs.${tab}`)}
            {tab === 'invitations' && stats.pendingInvitations ? <span className={styles.count}>{stats.pendingInvitations}</span> : null}
          </button>
        ))}
      </nav>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {inviteSent ? <InviteSentNote sent={inviteSent} onDismiss={() => setInviteSent(null)} /> : null}

      {loading ? (
        <p className="help">{t('loading')}</p>
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
  const t = useTranslations('Teams');
  const format = useFormatter();
  if (members.length === 0) {
    return <p className={`card ${styles.note}`}>{t('noMembers')}</p>;
  }
  return (
    <div className={`card ${styles.tableCard}`}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t('member')}</th>
            <th scope="col">{t('role')}</th>
            <th scope="col">{t('status')}</th>
            <th scope="col">{t('joined')}</th>
            {canManage ? <th scope="col" aria-label={t('actions')} /> : null}
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
                    <span className={styles.personName}>{member.user_full_name || member.user_email || t('unknown')}</span>
                    {member.user_full_name ? <span className={styles.personEmail}>{member.user_email}</span> : null}
                  </span>
                </div>
              </td>
              <td>
                {canManage && member.role !== 'owner' ? (
                  <select
                    className={`select ${styles.roleSelect}`}
                    value={member.role}
                    aria-label={t('roleFor', { member: member.user_email ?? t('member') })}
                    onChange={(e) => onUpdateRole(member.id, e.target.value)}
                  >
                    <option value="admin">{t('roles.admin')}</option>
                    <option value="member">{t('roles.member')}</option>
                    <option value="viewer">{t('roles.viewer')}</option>
                  </select>
                ) : (
                  <span className="badge">{label(t, 'roles', member.role)}</span>
                )}
              </td>
              <td>
                <span className={`badge ${member.status === 'active' ? 'badgeLive' : ''}`}>{label(t, 'statuses', member.status)}</span>
              </td>
              <td className={styles.muted}>{member.joined_at ? format.dateTime(new Date(member.joined_at), { dateStyle: 'medium' }) : '—'}</td>
              {canManage ? (
                <td className={styles.actionsCell}>
                  {member.role !== 'owner' ? (
                    <button type="button" className="button buttonGhost" onClick={() => onRemove(member.id)}>
                      {t('remove')}
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

function CopyButton({ text, label: buttonLabel }: { text: string; label?: string }) {
  const t = useTranslations('Teams');
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="button buttonGhost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt(t('copyPrompt'), text);
        }
      }}
    >
      {copied ? t('copied') : (buttonLabel ?? t('copyLink'))}
    </button>
  );
}

function InviteSentNote({ sent, onDismiss }: { sent: InviteSent; onDismiss: () => void }) {
  const t = useTranslations('Teams');
  return (
    <div className={`card ${styles.note}`} role="status">
      <p>{sent.emailSent ? t('inviteEmailed', { email: sent.email }) : t('inviteCreated', { email: sent.email })}</p>
      <div className={styles.linkRow}>
        <code className={styles.link}>{sent.link}</code>
        <CopyButton text={sent.link} />
        <button type="button" className="button buttonGhost" onClick={onDismiss}>
          {t('done')}
        </button>
      </div>
    </div>
  );
}

function InvitesForMe({ invites }: { invites: InviteForMe[] }) {
  const t = useTranslations('Teams');
  return (
    <section className={`card ${styles.note}`} aria-label={t('forYou')}>
      <h2 className="cardTitle">{t('forYou')}</h2>
      <ul className={styles.inviteList}>
        {invites.map((invite) => (
          <li key={invite.invitePath}>
            <span>
              {t.rich('invitedYou', {
                team: invite.teamName,
                role: label(t, 'roles', invite.role),
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </span>
            <Link className="button buttonPrimary" href={invite.invitePath}>
              {t('viewInvitation')}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function InvitationsTab({
  invitations,
  canManage,
  onCancel,
  onInvite,
}: {
  invitations: TeamInvitation[];
  canManage: boolean;
  onCancel: (id: string) => void;
  onInvite: () => void;
}) {
  const t = useTranslations('Teams');
  const format = useFormatter();
  if (invitations.length === 0) {
    return (
      <div className={`card ${styles.note}`}>
        <p>{t('noInvitations')}</p>
        {canManage ? (
          <button type="button" className="button" onClick={onInvite}>
            {t('invite')}
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
            <th scope="col">{t('email')}</th>
            <th scope="col">{t('role')}</th>
            <th scope="col">{t('status')}</th>
            <th scope="col">{t('expires')}</th>
            {canManage ? <th scope="col" aria-label={t('actions')} /> : null}
          </tr>
        </thead>
        <tbody>
          {invitations.map((inv) => (
            <tr key={inv.id}>
              <td>{inv.email}</td>
              <td>{label(t, 'roles', inv.role)}</td>
              <td>
                <span className="badge">{label(t, 'statuses', inv.status)}</span>
              </td>
              <td className={styles.muted}>{format.dateTime(new Date(inv.expires_at), { dateStyle: 'medium' })}</td>
              {canManage ? (
                <td className={styles.actionsCell}>
                  {inv.invitePath ? <CopyButton text={absoluteLink(inv.invitePath)} /> : null}
                  <button type="button" className="button buttonGhost" onClick={() => onCancel(inv.id)}>
                    {t('cancel')}
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
  const t = useTranslations('Teams');
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
        <h3 className="cardTitle">{t('details')}</h3>
        <label className="label" htmlFor={nameId}>
          {t('name')}
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
          <span>{t('address')}</span>
          <code>{organization.slug}</code>
        </div>
        <div className={styles.readOnly}>
          <span>{t('planLabel')}</span>
          <span>{label(t, 'plans', organization.plan)}</span>
        </div>
        {canEdit ? (
          <div className={styles.formActions}>
            {saved ? <span className={styles.saved}>{t('saved')}</span> : null}
            <button type="submit" className="button buttonPrimary" disabled={saving || !name.trim() || name.trim() === organization.name}>
              {saving ? t('saving') : t('saveName')}
            </button>
          </div>
        ) : (
          <p className="help">{t('ownerOnly')}</p>
        )}
      </div>
    </form>
  );
}

type SsoView = {
  enabled: boolean;
  domains: string[];
  metadataUrl: string | null;
  manageable: boolean;
  serviceProvider: { entityId: string; metadataUrl: string; acsUrl: string; nameIdFormat: string } | null;
};

/** A DNS TXT record that proves the team owns a domain (src/lib/ssoVerification.ts). */
type DomainRecord = { domain: string; type: 'TXT'; name: string; value: string };

function SSOTab({ organization, canEdit }: { organization: Organization; canEdit: boolean }) {
  const t = useTranslations('Teams');
  const [view, setView] = useState<SsoView | null>(null);
  const [domains, setDomains] = useState('');
  const [source, setSource] = useState<'url' | 'xml'>('url');
  const [metadataUrl, setMetadataUrl] = useState('');
  const [metadataXml, setMetadataXml] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [records, setRecords] = useState<DomainRecord[]>([]);
  const ids = { domains: useId(), url: useId(), xml: useId() };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/teams/${organization.id}/sso`).catch(() => null);
      const data = res?.ok ? ((await res.json()) as SsoView) : null;
      if (cancelled || !data) return;
      setView(data);
      setDomains(data.domains.join(', '));
      setMetadataUrl(data.metadataUrl ?? '');
    })();
    return () => {
      cancelled = true;
    };
  }, [organization.id]);

  async function send(method: 'PUT' | 'DELETE') {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/teams/${organization.id}/sso`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body:
          method === 'PUT'
            ? JSON.stringify({
                domains: domains.split(/[\s,]+/).filter(Boolean),
                ...(source === 'url' ? { metadataUrl: metadataUrl.trim() } : { metadataXml: metadataXml.trim() }),
              })
            : undefined,
      });
      const data = await res.json().catch(() => ({}));
      setRecords(data?.error === 'domain_unverified' && Array.isArray(data.records) ? (data.records as DomainRecord[]) : []);
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' && t.has(`sso.errors.${data.error}`) ? t(`sso.errors.${data.error}`) : t('sso.failed'));
      }
      setView(data as SsoView);
      setMessage({ kind: 'ok', text: method === 'PUT' ? t('sso.on') : t('sso.off') });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : t('sso.failed') });
    } finally {
      setBusy(false);
    }
  }

  if (!view) return <p className="help">{t('loading')}</p>;
  const sp = view.serviceProvider;
  const metadataReady = source === 'url' ? metadataUrl.trim().startsWith('https://') : metadataXml.trim().length > 50;

  return (
    <div className="card">
      <div className="cardInner stack">
        <div className={styles.ssoRow}>
          <div>
            <h3 className="cardTitle">{t('sso.title')}</h3>
            <p className="help">{t('sso.desc')}</p>
          </div>
          <span className={`badge ${view.enabled ? 'badgeLive' : ''}`}>{view.enabled ? t('sso.badgeOn') : t('sso.badgeOff')}</span>
        </div>

        {!view.manageable ? (
          <p className={styles.note} role="status">
            {t('sso.errors.not_configured')} {t('sso.askAdmin')}
          </p>
        ) : null}

        {sp ? (
          <div className="stack" style={{ gap: 8 }}>
            <span className="label">{t('sso.forProvider')}</span>
            {[
              [t('sso.entityId'), sp.entityId],
              [t('sso.acsUrl'), sp.acsUrl],
              [t('sso.metadata'), sp.metadataUrl],
            ].map(([name, value]) => (
              <div key={name} className={styles.linkRow}>
                <span className={styles.muted} style={{ minWidth: 120 }}>{name}</span>
                <code className={styles.link}>{value}</code>
                <CopyButton text={value} label={t('copy')} />
              </div>
            ))}
            <span className="help">{t('sso.nameId')}</span>
          </div>
        ) : null}

        {canEdit ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void send('PUT');
            }}
          >
            <label className="label" htmlFor={ids.domains}>
              {t('sso.domains')}
              <input
                id={ids.domains}
                className="input"
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
                placeholder={t('sso.domainsPlaceholder')}
                disabled={busy}
              />
              <span className="help">{t('sso.domainsHelp')}</span>
            </label>
            <div className="row" role="radiogroup" aria-label={t('sso.metadataChoice')} style={{ gap: 16 }}>
              <label className="checkbox-label">
                <input type="radio" checked={source === 'url'} onChange={() => setSource('url')} disabled={busy} />
                <span>{t('sso.metadataUrl')}</span>
              </label>
              <label className="checkbox-label">
                <input type="radio" checked={source === 'xml'} onChange={() => setSource('xml')} disabled={busy} />
                <span>{t('sso.metadataXml')}</span>
              </label>
            </div>
            {source === 'url' ? (
              <label className="label" htmlFor={ids.url}>
                {t('sso.metadataUrlLabel')}
                <input
                  id={ids.url}
                  className="input"
                  type="url"
                  value={metadataUrl}
                  onChange={(e) => setMetadataUrl(e.target.value)}
                  placeholder={t('sso.metadataUrlPlaceholder')}
                  disabled={busy}
                />
              </label>
            ) : (
              <label className="label" htmlFor={ids.xml}>
                {t('sso.metadataXmlLabel')}
                <textarea
                  id={ids.xml}
                  className="textarea"
                  rows={5}
                  value={metadataXml}
                  onChange={(e) => setMetadataXml(e.target.value)}
                  placeholder={t('sso.metadataXmlPlaceholder')}
                  disabled={busy}
                />
              </label>
            )}
            {records.length ? (
              <div className="stack" style={{ gap: 8 }} aria-live="polite">
                <span className="label">{t('sso.verifyTitle')}</span>
                <span className="help">{t('sso.verifyHelp')}</span>
                {records.map((record) => (
                  <div key={record.name} className="stack" style={{ gap: 4 }}>
                    <strong>{record.domain}</strong>
                    {[
                      [t('sso.recordType'), record.type],
                      [t('sso.recordName'), record.name],
                      [t('sso.recordValue'), record.value],
                    ].map(([name, value]) => (
                      <div key={name} className={styles.linkRow}>
                        <span className={styles.muted} style={{ minWidth: 120 }}>{name}</span>
                        <code className={styles.link}>{value}</code>
                        <CopyButton text={value} label={t('copy')} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
            <p className="help" style={{ margin: 0 }}>
              {t('sso.separateAccounts')}
            </p>
            <div className={styles.formActions}>
              {message ? (
                <span className="help" role={message.kind === 'error' ? 'alert' : 'status'}>
                  {message.text}
                </span>
              ) : null}
              {view.enabled ? (
                <button type="button" className="button" onClick={() => void send('DELETE')} disabled={busy}>
                  {t('sso.turnOff')}
                </button>
              ) : null}
              <button type="submit" className="button buttonPrimary" disabled={busy || !view.manageable || !domains.trim() || !metadataReady}>
                {busy ? t('saving') : view.enabled ? t('sso.save') : t('sso.turnOn')}
              </button>
            </div>
          </form>
        ) : (
          <p className="help">{t('sso.ownerOnly')}</p>
        )}
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
  const t = useTranslations('Teams');
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const ids = { email: useId(), role: useId() };
  return (
    <Modal title={t('invite')} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          onInvite(email.trim(), inviteRole);
        }}
      >
        <label className="label" htmlFor={ids.email}>
          {t('email')}
          <input
            id={ids.email}
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('emailPlaceholder')}
            required
            autoFocus
          />
        </label>
        <label className="label" htmlFor={ids.role}>
          {t('role')}
          <select id={ids.role} className="select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            <option value="member">{t('roles.member')}</option>
            <option value="admin">{t('roleAdminHelp')}</option>
            <option value="viewer">{t('roleViewerHelp')}</option>
          </select>
        </label>
        <div className={styles.formActions}>
          <button type="button" className="button" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="button buttonPrimary" disabled={!email.trim()}>
            {t('sendInvitation')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CreateTeamModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, slug: string) => void }) {
  const t = useTranslations('Teams');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const ids = { name: useId(), slug: useId() };
  const toSlug = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

  return (
    <Modal title={t('create')} onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          onCreate(name.trim(), slug);
        }}
      >
        <label className="label" htmlFor={ids.name}>
          {t('name')}
          <input
            id={ids.name}
            className="input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugEdited) setSlug(toSlug(e.target.value));
            }}
            placeholder={t('namePlaceholder')}
            required
            autoFocus
            maxLength={100}
          />
        </label>
        <label className="label" htmlFor={ids.slug}>
          {t('address')}
          <input
            id={ids.slug}
            className="input"
            value={slug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(toSlug(e.target.value));
            }}
            placeholder={t('addressPlaceholder')}
            required
          />
          <span className="help">{t('addressHelp')}</span>
        </label>
        <div className={styles.formActions}>
          <button type="button" className="button" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="button buttonPrimary" disabled={!name.trim() || !slug}>
            {t('createTeam')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
