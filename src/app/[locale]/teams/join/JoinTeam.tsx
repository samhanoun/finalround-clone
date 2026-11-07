'use client';

import { useState } from 'react';
import { Link, useRouter } from '@/i18n/routing';
import { useFormatter, useTranslations } from 'next-intl';
import { ApexMark } from '@/components/ApexMark';
import type { InvitationPreview } from '@/lib/teamInvites';
import styles from './join.module.css';

export function JoinTeam({
  token,
  invitation,
  signedInAs,
}: {
  token: string;
  invitation: InvitationPreview | null;
  signedInAs: string | null;
}) {
  const t = useTranslations('JoinTeam');
  const format = useFormatter();
  const router = useRouter();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const here = `/teams/join?token=${encodeURIComponent(token)}`;

  async function respond(action: 'accept' | 'decline') {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/teams/invitations/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof json?.error === 'string' && t.has(`errors.${json.error}`) ? t(`errors.${json.error}`) : t('failed'));
      }
      if (action === 'accept') {
        router.push('/teams');
        router.refresh();
      } else {
        setDeclined(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failed'));
    } finally {
      setBusy(null);
    }
  }

  let body: React.ReactNode;
  if (!invitation) {
    body = (
      <>
        <h1 className={styles.title}>{t('invalidTitle')}</h1>
        <p className={styles.text}>{t('invalidBody')}</p>
      </>
    );
  } else if (declined) {
    body = (
      <>
        <h1 className={styles.title}>{t('declinedTitle')}</h1>
        <p className={styles.text}>{t('declinedBody', { team: invitation.teamName })}</p>
      </>
    );
  } else if (invitation.status !== 'pending') {
    body = (
      <>
        <h1 className={styles.title}>{invitation.teamName}</h1>
        <p className={styles.text}>
          {invitation.status === 'expired' ? t('errors.expired') : t('errors.not_pending')}
        </p>
      </>
    );
  } else {
    const wrongAccount = signedInAs !== null && signedInAs.toLowerCase() !== invitation.email.toLowerCase();
    body = (
      <>
        <h1 className={styles.title}>{t('join', { team: invitation.teamName })}</h1>
        <p className={styles.text}>
          {t.rich('invited', {
            inviter: invitation.invitedBy ?? t('teammate'),
            email: invitation.email,
            role: t.has(`roles.${invitation.role}`) ? t(`roles.${invitation.role}`) : invitation.role,
            date: format.dateTime(new Date(invitation.expiresAt), { dateStyle: 'long' }),
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
        {signedInAs === null ? (
          <div className={styles.actions}>
            <Link className="button buttonPrimary" href={`/auth?next=${encodeURIComponent(here)}`}>
              {t('signIn')}
            </Link>
            <Link className="button" href={`/auth?mode=signup&next=${encodeURIComponent(here)}`}>
              {t('signUp')}
            </Link>
          </div>
        ) : wrongAccount ? (
          <p className={styles.warning} role="alert">
            {t('signedInAs', { email: signedInAs })} {t('errors.wrong_account')}
          </p>
        ) : (
          <div className={styles.actions}>
            <button className="button buttonPrimary" type="button" disabled={busy !== null} onClick={() => void respond('accept')}>
              {busy === 'accept' ? t('joining') : t('join', { team: invitation.teamName })}
            </button>
            <button className="button" type="button" disabled={busy !== null} onClick={() => void respond('decline')}>
              {busy === 'decline' ? t('declining') : t('decline')}
            </button>
          </div>
        )}
        {error ? (
          <p className={styles.warning} role="alert">
            {error}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <section className={`card ${styles.card}`}>
      <div className="cardInner stack">
        {signedInAs === null ? <ApexMark size={32} /> : null}
        {body}
      </div>
    </section>
  );
}
