'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from '@/i18n/routing';
import { useFormatter, useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/browser';
import { CheckIcon, CopyIcon } from '@/components/icons';
import { Skeleton } from '@/components/Skeleton';
import { Segmented } from '@/app/[locale]/settings/SettingsUI';
import type { Organization, OrganizationMember, OrganizationInvitation, OrganizationRole } from '@/lib/organizations';
import styles from './TeamsClient.module.css';

interface TeamsClientProps {
  initialOrganization: Organization | null;
  role: OrganizationRole | null;
}

type T = ReturnType<typeof useTranslations>;

/** A stored value (plan, role, status) in the user's language when the messages know it. */
function label(t: T, group: string, value: string) {
  return t.has(`${group}.${value}`) ? t(`${group}.${value}`) : value;
}

type TeamInvitation = OrganizationInvitation & { invitePath?: string };
type InviteForMe = { teamName: string; role: string; expiresAt: string; invitePath: string };
type InviteSent = { email: string; emailSent: boolean; link: string };

type SsoView = {
  enabled: boolean;
  domains: string[];
  metadataUrl: string | null;
  manageable: boolean;
  serviceProvider: { entityId: string; metadataUrl: string; acsUrl: string; nameIdFormat: string } | null;
};

/** A DNS TXT record that proves the team owns a domain (src/lib/ssoVerification.ts). */
type DomainRecord = { domain: string; type: 'TXT'; name: string; value: string };

function absoluteLink(path: string) {
  return typeof window === 'undefined' ? path : `${window.location.origin}${path}`;
}

/**
 * Teams: the team at a glance, its members and their roles, invitations,
 * single sign-on, the team's details and, for the owner, a danger zone.
 * Without a team: invitations sent to you and a way to start one.
 */
export default function TeamsClient({ initialOrganization, role }: TeamsClientProps) {
  const t = useTranslations('Teams');
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
  const [sso, setSso] = useState<SsoView | null>(null);

  const canManage = myRole === 'owner' || myRole === 'admin';

  // The first load shows placeholders (loading starts true); reloads after an action refresh in place.
  const loadData = useCallback(
    async (org: Organization) => {
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
    },
    [t],
  );

  const loadInvitations = useCallback(
    async (org: Organization) => {
      try {
        const res = await fetch(`/api/teams/${org.id}/invitations`);
        const data = await res.json().catch(() => ({}));
        if (data.invitations) setInvitations(data.invitations);
      } catch {
        setError(t('errors.invitations'));
      }
    },
    [t],
  );

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

  // Owners and admins: the pending invitations and the single sign-on setup.
  const orgId = organization?.id ?? null;
  useEffect(() => {
    if (!orgId || !canManage) return;
    let cancelled = false;
    void (async () => {
      const [invitesRes, ssoRes] = await Promise.all([
        fetch(`/api/teams/${orgId}/invitations`).catch(() => null),
        fetch(`/api/teams/${orgId}/sso`).catch(() => null),
      ]);
      const invites = invitesRes?.ok ? await invitesRes.json().catch(() => null) : null;
      const view = ssoRes?.ok ? ((await ssoRes.json().catch(() => null)) as SsoView | null) : null;
      if (cancelled) return;
      if (invites?.invitations) setInvitations(invites.invitations);
      if (view) setSso(view);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, canManage]);

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
    if (!organization) return false;
    setError(null);
    const res = await fetch(`/api/teams/${organization.id}/invitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role: inviteRole }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) {
      setError(data?.error === 'already_member' ? t('errors.alreadyMember', { email }) : t('errors.invite'));
      return false;
    }
    setInviteSent({ email, emailSent: Boolean(data.emailSent), link: absoluteLink(data.invitation.invitePath) });
    void loadInvitations(organization);
    void loadData(organization);
    return true;
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
  const errorLine = error ? (
    <p className={styles.error} role="alert">
      {error}
    </p>
  ) : null;

  if (loading && !organization) {
    return (
      <div className={styles.page} role="status" aria-label={t('loadingTeam')}>
        <Skeleton width="240px" height="20px" borderRadius="6px" />
        <Skeleton width="100%" height="200px" borderRadius="var(--radius-card)" />
      </div>
    );
  }

  if (!organization) {
    return (
      <div className={styles.page}>
        {forMe}
        {errorLine}
        <CreateTeam onCreate={handleCreateTeam} />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {forMe}

      <header className={styles.overview}>
        <div className={styles.identity}>
          <h2 className={styles.teamName}>{organization.name}</h2>
          <p className={styles.teamMeta}>
            {t('plan', { plan: label(t, 'plans', organization.plan) })}
            {myRole ? <> · {t('youAre', { role: label(t, 'roles', myRole) })}</> : null}
          </p>
        </div>
        <dl className={styles.stats}>
          <Stat label={t('stats.members')} value={stats.totalMembers} />
          <Stat label={t('stats.active')} value={stats.activeMembers} />
          <Stat label={t('stats.interviews')} value={stats.totalInterviews} />
          <Stat label={t('stats.thisMonth')} value={stats.interviewsThisMonth} />
        </dl>
      </header>

      {errorLine}

      <section className={styles.section} aria-labelledby="team-members">
        <h3 className={styles.sectionTitle} id="team-members">
          {t('tabs.members')}
          {!loading ? <span className={styles.count}>{members.length}</span> : null}
        </h3>
        {loading ? (
          <div className={styles.group} aria-hidden="true">
            {[0, 1].map((i) => (
              <div key={i} className={styles.skeletonRow}>
                <Skeleton width="28px" height="28px" borderRadius="50%" />
                <Skeleton width="40%" height="14px" />
              </div>
            ))}
          </div>
        ) : (
          <MembersList members={members} canManage={canManage} onRemove={handleRemoveMember} onUpdateRole={handleUpdateRole} />
        )}
      </section>

      {canManage ? (
        <section className={styles.section} aria-labelledby="team-invitations">
          <h3 className={styles.sectionTitle} id="team-invitations">
            {t('tabs.invitations')}
            {invitations.length ? <span className={styles.count}>{invitations.length}</span> : null}
          </h3>
          <div className={styles.group}>
            <InviteForm onInvite={handleInvite} />
            {inviteSent ? <InviteSentNote sent={inviteSent} onDismiss={() => setInviteSent(null)} /> : null}
            <InvitationsList invitations={invitations} onCancel={handleCancelInvitation} />
          </div>
        </section>
      ) : null}

      {canManage ? (
        <SsoSection organization={organization} canEdit={myRole === 'owner'} view={sso} onView={setSso} />
      ) : null}

      <DetailsSection organization={organization} canEdit={myRole === 'owner'} onRename={handleRename} />

      {myRole === 'owner' ? (
        <DangerZone
          organization={organization}
          ssoEnabled={Boolean(sso?.enabled)}
          onView={setSso}
          onDeleted={() => {
            setOrganization(null);
            setMyRole(null);
            setMembers([]);
            setInvitations([]);
            setSso(null);
          }}
        />
      ) : null}
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

function MembersList({
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
    return <p className="emptyState">{t('noMembers')}</p>;
  }
  return (
    <ul className={`${styles.group} ${styles.list}`}>
      {members.map((member) => (
        <li key={member.id} className={styles.memberRow}>
          <div className={styles.person}>
            <span className={styles.avatar} aria-hidden="true">
              {initials(member)}
            </span>
            <span className={styles.personText}>
              <span className={styles.personName}>{member.user_full_name || member.user_email || t('unknown')}</span>
              <span className={styles.personMeta}>
                {member.user_full_name ? member.user_email : null}
                {member.status !== 'active' ? (
                  <>
                    {member.user_full_name ? ' · ' : null}
                    {label(t, 'statuses', member.status)}
                  </>
                ) : null}
              </span>
            </span>
          </div>
          <div className={styles.memberRole}>
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
              <span className={styles.roleText}>{label(t, 'roles', member.role)}</span>
            )}
          </div>
          <span className={styles.memberJoined}>
            {member.joined_at ? t('joinedOn', { date: format.dateTime(new Date(member.joined_at), { dateStyle: 'medium' }) }) : null}
          </span>
          <div className={styles.rowActions}>
            {canManage && member.role !== 'owner' ? (
              <button
                type="button"
                className="button buttonGhost buttonSmall"
                onClick={() => onRemove(member.id)}
                aria-label={t('removeMember', { member: member.user_full_name || member.user_email || t('member') })}
              >
                {t('remove')}
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function CopyButton({ text, label: buttonLabel, describedBy }: { text: string; label?: string; describedBy?: string }) {
  const t = useTranslations('Teams');
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="button buttonGhost buttonSmall"
      aria-describedby={describedBy}
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
      {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
      <span aria-live="polite">{copied ? t('copied') : (buttonLabel ?? t('copyLink'))}</span>
    </button>
  );
}

/** A value to paste somewhere else (a link, a DNS record): mono, selectable, with Copy. */
function CopyValue({ name, value }: { name: string; value: string }) {
  const t = useTranslations('Teams');
  const id = useId();
  return (
    <div className={styles.copyRow}>
      <span className={styles.copyName} id={id}>
        {name}
      </span>
      <code className={styles.copyValue}>{value}</code>
      <CopyButton text={value} label={t('copy')} describedBy={id} />
    </div>
  );
}

function InviteSentNote({ sent, onDismiss }: { sent: InviteSent; onDismiss: () => void }) {
  const t = useTranslations('Teams');
  return (
    <div className={styles.block} role="status">
      <p className={styles.blockText}>{sent.emailSent ? t('inviteEmailed', { email: sent.email }) : t('inviteCreated', { email: sent.email })}</p>
      <div className={styles.linkRow}>
        <code className={styles.copyValue}>{sent.link}</code>
        <CopyButton text={sent.link} />
        <button type="button" className="button buttonGhost buttonSmall" onClick={onDismiss}>
          {t('done')}
        </button>
      </div>
    </div>
  );
}

function InvitesForMe({ invites }: { invites: InviteForMe[] }) {
  const t = useTranslations('Teams');
  return (
    <section className={styles.section} aria-labelledby="team-for-you">
      <h2 className={styles.sectionTitle} id="team-for-you">
        {t('forYou')}
      </h2>
      <ul className={`${styles.group} ${styles.list}`}>
        {invites.map((invite) => (
          <li key={invite.invitePath} className={styles.simpleRow}>
            <span className={styles.blockText}>
              {t.rich('invitedYou', {
                team: invite.teamName,
                role: label(t, 'roles', invite.role),
                strong: (chunks) => <strong className={styles.strong}>{chunks}</strong>,
              })}
            </span>
            <Link className="button buttonSmall" href={invite.invitePath}>
              {t('viewInvitation')}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function InviteForm({ onInvite }: { onInvite: (email: string, role: string) => Promise<boolean> }) {
  const t = useTranslations('Teams');
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [sending, setSending] = useState(false);
  const ids = { email: useId(), role: useId(), title: useId() };
  return (
    <form
      className={styles.inviteForm}
      aria-labelledby={ids.title}
      onSubmit={async (e) => {
        e.preventDefault();
        setSending(true);
        const ok = await onInvite(email.trim(), inviteRole);
        setSending(false);
        if (ok) setEmail('');
      }}
    >
      <span className={styles.inviteTitle} id={ids.title}>
        {t('invite')}
      </span>
      <div className={styles.inviteFields}>
        <label className="srOnly" htmlFor={ids.email}>
          {t('email')}
        </label>
        <input
          id={ids.email}
          className="input"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('emailPlaceholder')}
          required
        />
        <label className="srOnly" htmlFor={ids.role}>
          {t('role')}
        </label>
        <select id={ids.role} className={`select ${styles.inviteRole}`} value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
          <option value="member">{t('roles.member')}</option>
          <option value="admin">{t('roleAdminHelp')}</option>
          <option value="viewer">{t('roleViewerHelp')}</option>
        </select>
        <button type="submit" className="button buttonPrimary" disabled={!email.trim() || sending}>
          {sending ? t('sending') : t('sendInvitation')}
        </button>
      </div>
    </form>
  );
}

function InvitationsList({ invitations, onCancel }: { invitations: TeamInvitation[]; onCancel: (id: string) => void }) {
  const t = useTranslations('Teams');
  const format = useFormatter();
  if (invitations.length === 0) {
    return <p className={`${styles.block} ${styles.quiet}`}>{t('noInvitations')}</p>;
  }
  return (
    <ul className={styles.list}>
      {invitations.map((inv) => (
        <li key={inv.id} className={styles.inviteRow}>
          <span className={styles.personText}>
            <span className={styles.personName}>{inv.email}</span>
            <span className={styles.personMeta}>
              {label(t, 'roles', inv.role)} · {label(t, 'statuses', inv.status)} ·{' '}
              {t('expiresOn', { date: format.dateTime(new Date(inv.expires_at), { dateStyle: 'medium' }) })}
            </span>
          </span>
          <div className={styles.rowActions}>
            {inv.invitePath ? <CopyButton text={absoluteLink(inv.invitePath)} /> : null}
            <button
              type="button"
              className="button buttonGhost buttonSmall"
              onClick={() => onCancel(inv.id)}
              aria-label={t('cancelInvitation', { email: inv.email })}
            >
              {t('cancel')}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function DetailsSection({
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
    <section className={styles.section} aria-labelledby="team-details">
      <h3 className={styles.sectionTitle} id="team-details">
        {t('details')}
      </h3>
      <form className={styles.group} onSubmit={save}>
        <div className={styles.fieldRow}>
          {canEdit ? (
            <>
              <label className={styles.fieldLabel} htmlFor={nameId}>
                {t('name')}
              </label>
              <div className={styles.inlineField}>
                <input
                  id={nameId}
                  className="input"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setSaved(false);
                  }}
                  maxLength={100}
                />
                <button type="submit" className="button" disabled={saving || !name.trim() || name.trim() === organization.name}>
                  {saving ? t('saving') : t('saveName')}
                </button>
                <span className={styles.savedNote} role="status">
                  {saved ? (
                    <>
                      <CheckIcon size={14} />
                      {t('saved')}
                    </>
                  ) : null}
                </span>
              </div>
            </>
          ) : (
            <>
              <span className={styles.fieldLabel}>{t('name')}</span>
              <span className={styles.fieldValue}>{organization.name}</span>
            </>
          )}
        </div>
        <div className={styles.fieldRow}>
          <span className={styles.fieldLabel}>{t('address')}</span>
          <code className={styles.fieldValueMono}>{organization.slug}</code>
        </div>
        <div className={styles.fieldRow}>
          <span className={styles.fieldLabel}>{t('planLabel')}</span>
          <span className={styles.fieldValue}>{label(t, 'plans', organization.plan)}</span>
        </div>
        {canEdit ? null : <p className={`${styles.block} ${styles.quiet}`}>{t('ownerOnly')}</p>}
      </form>
    </section>
  );
}

function SsoSection({
  organization,
  canEdit,
  view,
  onView,
}: {
  organization: Organization;
  canEdit: boolean;
  view: SsoView | null;
  onView: (view: SsoView) => void;
}) {
  const t = useTranslations('Teams');
  const [domains, setDomains] = useState<string | null>(null);
  const [source, setSource] = useState<'url' | 'xml'>('url');
  const [metadataUrl, setMetadataUrl] = useState<string | null>(null);
  const [metadataXml, setMetadataXml] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [records, setRecords] = useState<DomainRecord[]>([]);
  const ids = { domains: useId(), domainsHelp: useId(), url: useId(), xml: useId(), source: useId() };

  // The form starts from what is saved; once edited, it keeps the edits.
  const domainsValue = domains ?? view?.domains.join(', ') ?? '';
  const urlValue = metadataUrl ?? view?.metadataUrl ?? '';

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/teams/${organization.id}/sso`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domains: domainsValue.split(/[\s,]+/).filter(Boolean),
          ...(source === 'url' ? { metadataUrl: urlValue.trim() } : { metadataXml: metadataXml.trim() }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      setRecords(data?.error === 'domain_unverified' && Array.isArray(data.records) ? (data.records as DomainRecord[]) : []);
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' && t.has(`sso.errors.${data.error}`) ? t(`sso.errors.${data.error}`) : t('sso.failed'));
      }
      onView(data as SsoView);
      setMessage({ kind: 'ok', text: t('sso.on') });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : t('sso.failed') });
    } finally {
      setBusy(false);
    }
  }

  const sp = view?.serviceProvider ?? null;
  const metadataReady = source === 'url' ? urlValue.trim().startsWith('https://') : metadataXml.trim().length > 50;

  return (
    <section className={styles.section} aria-labelledby="team-sso">
      <div className={styles.sectionHeadRow}>
        <h3 className={styles.sectionTitle} id="team-sso">
          {t('tabs.sso')}
        </h3>
        {view ? (
          <span className={styles.state} data-on={view.enabled}>
            <span className={styles.dot} aria-hidden="true" />
            {view.enabled ? t('sso.badgeOn') : t('sso.badgeOff')}
          </span>
        ) : null}
      </div>
      <p className={styles.sectionDesc}>{t('sso.desc')}</p>

      {!view ? (
        <div className={styles.group} aria-hidden="true">
          <div className={styles.skeletonRow}>
            <Skeleton width="50%" height="14px" />
          </div>
        </div>
      ) : (
        <div className={styles.group}>
          {!view.manageable ? (
            <p className={`${styles.block} ${styles.quiet}`} role="status">
              {t('sso.errors.not_configured')} {t('sso.askAdmin')}
            </p>
          ) : null}

          {sp ? (
            <div className={styles.block}>
              <p className={styles.blockTitle}>{t('sso.forProvider')}</p>
              <div className={styles.copyList}>
                <CopyValue name={t('sso.entityId')} value={sp.entityId} />
                <CopyValue name={t('sso.acsUrl')} value={sp.acsUrl} />
                <CopyValue name={t('sso.metadata')} value={sp.metadataUrl} />
              </div>
              <p className={styles.quiet}>{t('sso.nameId')}</p>
            </div>
          ) : null}

          {canEdit ? (
            <form className={styles.block} onSubmit={save}>
              <div className={styles.ssoForm}>
                <label className="label" htmlFor={ids.domains}>
                  {t('sso.domains')}
                  <input
                    id={ids.domains}
                    className="input"
                    value={domainsValue}
                    onChange={(e) => setDomains(e.target.value)}
                    placeholder={t('sso.domainsPlaceholder')}
                    aria-describedby={ids.domainsHelp}
                    disabled={busy}
                  />
                  <span className="help" id={ids.domainsHelp}>
                    {t('sso.domainsHelp')}
                  </span>
                </label>

                <div className={styles.field}>
                  <span className="label" id={ids.source}>
                    {t('sso.metadataChoice')}
                  </span>
                  <div className={styles.sourceChoice}>
                    <Segmented
                      name={ids.source}
                      value={source}
                      labelledBy={ids.source}
                      disabled={busy}
                      options={[
                        { value: 'url', label: t('sso.metadataUrl') },
                        { value: 'xml', label: t('sso.metadataXml') },
                      ]}
                      onChange={setSource}
                    />
                  </div>
                </div>

                {source === 'url' ? (
                  <label className="label" htmlFor={ids.url}>
                    {t('sso.metadataUrlLabel')}
                    <input
                      id={ids.url}
                      className="input"
                      type="url"
                      value={urlValue}
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
                      className={`textarea ${styles.mono}`}
                      rows={5}
                      value={metadataXml}
                      onChange={(e) => setMetadataXml(e.target.value)}
                      placeholder={t('sso.metadataXmlPlaceholder')}
                      disabled={busy}
                    />
                  </label>
                )}

                {/* Live: the DNS records appear here when a save needs proof of the domain. */}
                <div aria-live="polite" className={styles.liveBlock}>
                  {records.length ? (
                    <div className={styles.records}>
                      <p className={styles.blockTitle}>{t('sso.verifyTitle')}</p>
                      <p className={styles.quiet}>{t('sso.verifyHelp')}</p>
                      {records.map((record) => (
                        <div key={record.name} className={styles.record}>
                          <span className={styles.recordDomain}>{record.domain}</span>
                          <div className={styles.copyList}>
                            <CopyValue name={t('sso.recordType')} value={record.type} />
                            <CopyValue name={t('sso.recordName')} value={record.name} />
                            <CopyValue name={t('sso.recordValue')} value={record.value} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <p className={styles.quiet}>{t('sso.separateAccounts')}</p>
                </div>

                <div className={styles.formActions}>
                  {message ? (
                    <span className={message.kind === 'error' ? styles.errorText : styles.quiet} role={message.kind === 'error' ? 'alert' : 'status'}>
                      {message.text}
                    </span>
                  ) : null}
                  <button
                    type="submit"
                    className="button"
                    disabled={busy || !view.manageable || !domainsValue.trim() || !metadataReady}
                  >
                    {busy ? t('saving') : view.enabled ? t('sso.save') : t('sso.turnOn')}
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <p className={`${styles.block} ${styles.quiet}`}>{t('sso.ownerOnly')}</p>
          )}
        </div>
      )}
    </section>
  );
}

/** Owner only: turning single sign-on off (while it's on) and deleting the team. */
function DangerZone({
  organization,
  ssoEnabled,
  onView,
  onDeleted,
}: {
  organization: Organization;
  ssoEnabled: boolean;
  onView: (view: SsoView) => void;
  onDeleted: () => void;
}) {
  const t = useTranslations('Teams');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteTeam() {
    if (!window.confirm(t('confirmDeleteTeam', { team: organization.name }))) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/teams/${organization.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(t('deleteTeamFailed'));
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('deleteTeamFailed'));
      setDeleting(false);
    }
  }

  async function turnOff() {
    if (!window.confirm(t('sso.confirmOff', { team: organization.name }))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/teams/${organization.id}/sso`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' && t.has(`sso.errors.${data.error}`) ? t(`sso.errors.${data.error}`) : t('sso.failed'));
      }
      onView(data as SsoView);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sso.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="team-danger">
      <h3 className={styles.sectionTitle} id="team-danger">
        {t('dangerZone')}
      </h3>
      <div className={`${styles.group} ${styles.groupDanger}`}>
        {ssoEnabled ? (
          <div className={styles.dangerRow}>
            <div className={styles.personText}>
              <span className={styles.personName}>{t('sso.turnOffTitle')}</span>
              <span className={styles.quiet}>{t('sso.turnOffHelp')}</span>
            </div>
            <button type="button" className="button buttonDanger" onClick={() => void turnOff()} disabled={busy || deleting}>
              {busy ? t('saving') : t('sso.turnOff')}
            </button>
          </div>
        ) : null}
        <div className={styles.dangerRow}>
          <div className={styles.personText}>
            <span className={styles.personName}>{t('deleteTeam')}</span>
            <span className={styles.quiet}>{t('deleteTeamHelp')}</span>
          </div>
          <button type="button" className="button buttonDanger" onClick={() => void deleteTeam()} disabled={busy || deleting}>
            {deleting ? t('deletingTeam') : t('deleteTeam')}
          </button>
        </div>
        {error ? (
          <p className={`${styles.block} ${styles.errorText}`} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function CreateTeam({ onCreate }: { onCreate: (name: string, slug: string) => Promise<void> }) {
  const t = useTranslations('Teams');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [creating, setCreating] = useState(false);
  const ids = { name: useId(), slug: useId(), slugHelp: useId(), title: useId() };
  const toSlug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);

  if (!open) {
    return (
      <div className="emptyState">
        <span>{t('emptyDesc')}</span>
        <button type="button" className="button buttonPrimary" onClick={() => setOpen(true)}>
          {t('create')}
        </button>
      </div>
    );
  }

  return (
    <form
      className={`${styles.group} ${styles.createForm}`}
      aria-labelledby={ids.title}
      onSubmit={async (e) => {
        e.preventDefault();
        setCreating(true);
        await onCreate(name.trim(), slug);
        setCreating(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      <h2 className={styles.sectionTitle} id={ids.title}>
        {t('create')}
      </h2>
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
          className={`input ${styles.mono}`}
          value={slug}
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(toSlug(e.target.value));
          }}
          placeholder={t('addressPlaceholder')}
          aria-describedby={ids.slugHelp}
          required
        />
        <span className="help" id={ids.slugHelp}>
          {t('addressHelp')}
        </span>
      </label>
      <div className={styles.formActions}>
        <button type="button" className="button buttonGhost" onClick={() => setOpen(false)}>
          {t('cancel')}
        </button>
        <button type="submit" className="button buttonPrimary" disabled={!name.trim() || !slug || creating}>
          {creating ? t('saving') : t('createTeam')}
        </button>
      </div>
    </form>
  );
}
