'use client';

import { useEffect, useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { SUPPORT_CATEGORIES, type SupportCategory, type SupportTicket } from '@/lib/supportTypes';
import styles from './SupportCenter.module.css';

type SupportData = { tickets?: SupportTicket[]; email?: string | null };

/** Your tickets and the address replies go to; null when they can't be loaded. */
async function fetchSupport(): Promise<SupportData | null> {
  const res = await fetch('/api/support').catch(() => null);
  return res?.ok ? ((await res.json().catch(() => null)) as SupportData | null) : null;
}

/** Help & support: open a ticket, follow the conversation, reply. */
export function SupportCenter() {
  const t = useTranslations('Support');
  const format = useFormatter();
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<SupportCategory>('technical');
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const ids = { subject: useId(), category: useId(), description: useId() };

  function apply(data: SupportData | null) {
    setTickets(data?.tickets ?? []);
    setEmail(data?.email ?? null);
  }

  async function load() {
    apply(await fetchSupport());
  }

  useEffect(() => {
    let cancelled = false;
    void fetchSupport().then((data) => {
      if (!cancelled) apply(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setMessage(null);
    const res = await fetch('/api/support', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject, category, description }),
    }).catch(() => null);
    setSending(false);
    if (!res?.ok) {
      const error = res ? (await res.json().catch(() => ({})))?.error : null;
      setMessage({ kind: 'error', text: error === 'rate_limited' ? t('rateLimited') : t('notSent') });
      return;
    }
    const data = await res.json();
    setTickets((current) => [data.ticket, ...(current ?? [])]);
    setOpen(data.ticket.id);
    setSubject('');
    setDescription('');
    setMessage({ kind: 'ok', text: t('sent', { email: email ?? '' }) });
  }

  return (
    <div className={styles.layout}>
      <section className="card" aria-labelledby="support-new">
        <form className="cardInner stack" onSubmit={submit}>
          <div>
            <h2 className="cardTitle" id="support-new">
              {t('newTitle')}
            </h2>
            <p className="help">{t('newHelp')}</p>
          </div>
          <label className="label" htmlFor={ids.subject}>
            {t('subject')}
            <input
              id={ids.subject}
              className="input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              minLength={3}
              maxLength={160}
              required
            />
          </label>
          <label className="label" htmlFor={ids.category}>
            {t('category')}
            <select id={ids.category} className="select" value={category} onChange={(e) => setCategory(e.target.value as SupportCategory)}>
              {SUPPORT_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {t(`categories.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="label" htmlFor={ids.description}>
            {t('description')}
            <textarea
              id={ids.description}
              className="textarea"
              rows={6}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('descriptionPlaceholder')}
              minLength={10}
              maxLength={5000}
              required
            />
          </label>
          {message ? (
            <p className="help" role={message.kind === 'error' ? 'alert' : 'status'} style={{ margin: 0 }}>
              {message.text}
            </p>
          ) : null}
          <button className="button buttonPrimary" type="submit" disabled={sending}>
            {sending ? t('sending') : t('send')}
          </button>
        </form>
      </section>

      <section className="card" aria-labelledby="support-mine">
        <div className="cardInner stack">
          <h2 className="cardTitle" id="support-mine">
            {t('mineTitle')}
          </h2>
          {tickets === null ? (
            <p className="help">{t('loading')}</p>
          ) : tickets.length === 0 ? (
            <p className="help">{t('none')}</p>
          ) : (
            <ul className={styles.tickets}>
              {tickets.map((ticket) => (
                <TicketItem
                  key={ticket.id}
                  ticket={ticket}
                  open={open === ticket.id}
                  onToggle={() => setOpen(open === ticket.id ? null : ticket.id)}
                  onReplied={() => void load()}
                  when={(iso) => format.dateTime(new Date(iso), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function TicketItem({
  ticket,
  open,
  onToggle,
  onReplied,
  when,
}: {
  ticket: SupportTicket;
  open: boolean;
  onToggle: () => void;
  onReplied: () => void;
  when: (iso: string) => string;
}) {
  const t = useTranslations('Support');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setFailed(false);
    const res = await fetch(`/api/support/${ticket.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: reply }),
    }).catch(() => null);
    setSending(false);
    if (!res?.ok) return setFailed(true);
    setReply('');
    onReplied();
  }

  return (
    <li className={styles.ticket}>
      <button type="button" className={styles.ticketHead} onClick={onToggle} aria-expanded={open}>
        <span>
          <strong>{ticket.subject}</strong>
          <span className={styles.meta}>
            {t(`categories.${ticket.category}`)} · {when(ticket.updated_at)}
          </span>
        </span>
        <span className={`badge ${ticket.status === 'waiting_user' ? 'badgeIce' : ''}`}>{t(`status.${ticket.status}`)}</span>
      </button>
      {open ? (
        <div className="stack" style={{ gap: 10 }}>
          <p className={styles.body}>{ticket.description}</p>
          {ticket.messages.length ? (
            <ol className={styles.thread}>
              {ticket.messages.map((message) => (
                <li key={message.id} data-from={message.is_from_admin ? 'support' : 'you'}>
                  <span className={styles.meta}>
                    {message.is_from_admin ? t('fromSupport') : t('fromYou')} · {when(message.created_at)}
                  </span>
                  <p>{message.content}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="help">{t('noReplies')}</p>
          )}
          {ticket.status !== 'closed' ? (
            <form className="stack" style={{ gap: 8 }} onSubmit={send}>
              <label className="label">
                {t('reply')}
                <textarea className="textarea" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={5000} required />
              </label>
              {failed ? (
                <p className="help" role="alert">
                  {t('notSent')}
                </p>
              ) : null}
              <button className="button" type="submit" disabled={sending || !reply.trim()}>
                {sending ? t('sending') : t('sendReply')}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
