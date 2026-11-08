'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { ChevronLeftIcon, PlusIcon } from '@/components/icons';
import { Skeleton } from '@/components/Skeleton';
import { SUPPORT_CATEGORIES, type SupportCategory, type SupportTicket } from '@/lib/supportTypes';
import styles from './SupportCenter.module.css';

type SupportData = { tickets?: SupportTicket[]; email?: string | null };

/** Your tickets and the address replies go to; null when they can't be loaded. */
async function fetchSupport(): Promise<SupportData | null> {
  const res = await fetch('/api/support').catch(() => null);
  return res?.ok ? ((await res.json().catch(() => null)) as SupportData | null) : null;
}

/** "new" is the request form; otherwise a ticket id. */
type Selection = 'new' | string;

/**
 * Help & support: your requests as a list, a form for a new one, and each
 * request as a conversation. Desktop shows the list beside the open item;
 * phones show the list, then the item full width with a back button.
 */
export function SupportCenter() {
  const t = useTranslations('Support');
  const format = useFormatter();
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [notice, setNotice] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const apply = useCallback((data: SupportData | null, first: boolean) => {
    const list = data?.tickets ?? [];
    setTickets(list);
    setEmail(data?.email ?? null);
    if (!first) return;
    // First visit: open the request that is waiting for you, if any; with no requests, the form.
    const waiting = list.find((ticket) => ticket.status === 'waiting_user');
    setSelected((current) => current ?? (waiting ? waiting.id : 'new'));
    if (!list.length) setView('detail');
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchSupport().then((data) => {
      if (!cancelled) apply(data, true);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  async function reload() {
    apply(await fetchSupport(), false);
  }

  function open(next: Selection) {
    setSelected(next);
    setNotice(null);
    setView('detail');
    // Phones swap the list for the item: start it at the top, with focus on its heading.
    window.requestAnimationFrame(() => {
      if (window.matchMedia?.('(max-width: 767px)').matches) window.scrollTo({ top: 0 });
      detailRef.current?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    });
  }

  const when = (iso: string) => format.dateTime(new Date(iso), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const day = (iso: string) => format.dateTime(new Date(iso), { day: 'numeric', month: 'short' });
  const current = selected && selected !== 'new' ? (tickets?.find((ticket) => ticket.id === selected) ?? null) : null;
  const showingForm = selected !== null && !current;

  return (
    <div className={styles.layout} data-view={view}>
      <section className={styles.listPane} aria-labelledby="support-mine">
        <div className={styles.listHead}>
          <h2 className={styles.paneTitle} id="support-mine">
            {t('mineTitle')}
            {tickets?.length ? <span className={styles.count}>{tickets.length}</span> : null}
          </h2>
          <button
            type="button"
            className={`button buttonSmall ${styles.newButton}`}
            aria-current={showingForm ? 'true' : undefined}
            onClick={() => open('new')}
          >
            <PlusIcon size={16} />
            {t('newRequest')}
          </button>
        </div>

        {tickets === null ? (
          <div className={styles.list} role="status" aria-label={t('loading')}>
            {[0, 1, 2].map((i) => (
              <div key={i} className={styles.skeletonItem}>
                <Skeleton width="70%" height="14px" />
                <Skeleton width="45%" height="12px" />
              </div>
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <p className="emptyState">{t('none')}</p>
        ) : (
          <ul className={styles.list}>
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <button
                  type="button"
                  className={styles.item}
                  aria-current={current?.id === ticket.id ? 'true' : undefined}
                  onClick={() => open(ticket.id)}
                >
                  <span className={styles.itemTop}>
                    <span className={styles.itemSubject}>{ticket.subject}</span>
                    <time className={styles.itemTime} dateTime={ticket.updated_at}>
                      {day(ticket.updated_at)}
                    </time>
                  </span>
                  <span className={styles.itemBottom}>
                    <span className={styles.itemMeta}>{t(`categories.${ticket.category}`)}</span>
                    <Status status={ticket.status} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className={styles.detailPane} ref={detailRef}>
        <button type="button" className={`button buttonGhost buttonSmall ${styles.back}`} onClick={() => setView('list')}>
          <ChevronLeftIcon size={16} />
          {t('mineTitle')}
        </button>
        {/* Always in the page, so "Sent" is heard when the new request opens. */}
        <p className={styles.notice} role="status">
          {current ? notice : null}
        </p>
        {current ? (
          <TicketThread
            key={current.id}
            ticket={current}
            when={when}
            onReplied={() => {
              setNotice(null);
              void reload();
            }}
          />
        ) : (
          <NewRequest
            email={email}
            onCreated={(ticket, message) => {
              setTickets((list) => [ticket, ...(list ?? [])]);
              setSelected(ticket.id);
              setNotice(message);
            }}
          />
        )}
      </div>
    </div>
  );
}

function Status({ status }: { status: SupportTicket['status'] }) {
  const t = useTranslations('Support');
  return (
    <span className={styles.status} data-status={status}>
      <span className={styles.dot} aria-hidden="true" />
      {t(`status.${status}`)}
    </span>
  );
}

function NewRequest({ email, onCreated }: { email: string | null; onCreated: (ticket: SupportTicket, notice: string) => void }) {
  const t = useTranslations('Support');
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<SupportCategory>('technical');
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { subject: useId(), category: useId(), description: useId() };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(null);
    const res = await fetch('/api/support', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject, category, description }),
    }).catch(() => null);
    setSending(false);
    if (!res?.ok) {
      const code = res ? (await res.json().catch(() => ({})))?.error : null;
      setError(code === 'rate_limited' ? t('rateLimited') : t('notSent'));
      return;
    }
    const data = await res.json();
    setSubject('');
    setDescription('');
    onCreated(data.ticket, t('sent', { email: email ?? '' }));
  }

  return (
    <form className={styles.form} onSubmit={submit} aria-labelledby="support-new">
      <header className={styles.detailHead}>
        <h2 className={styles.detailTitle} id="support-new" tabIndex={-1}>
          {t('newTitle')}
        </h2>
        <p className={styles.detailMeta}>{t('newHelp')}</p>
      </header>
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
      <div className={styles.formFoot}>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <button className="button buttonPrimary" type="submit" disabled={sending}>
          {sending ? t('sending') : t('send')}
        </button>
      </div>
    </form>
  );
}

function TicketThread({ ticket, when, onReplied }: { ticket: SupportTicket; when: (iso: string) => string; onReplied: () => void }) {
  const t = useTranslations('Support');
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const replyId = useId();

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

  // What you wrote first opens the conversation.
  const entries = [
    { id: 'request', fromSupport: false, content: ticket.description, at: ticket.created_at },
    ...ticket.messages.map((message) => ({ id: message.id, fromSupport: message.is_from_admin, content: message.content, at: message.created_at })),
  ];

  return (
    <article className={styles.thread} aria-labelledby={`ticket-${ticket.id}`}>
      <header className={styles.detailHead}>
        <div className={styles.detailTitleRow}>
          <h2 className={styles.detailTitle} id={`ticket-${ticket.id}`} tabIndex={-1}>
            {ticket.subject}
          </h2>
          <Status status={ticket.status} />
        </div>
        <p className={styles.detailMeta}>
          {t(`categories.${ticket.category}`)} · {t('opened', { date: when(ticket.created_at) })}
        </p>
      </header>

      <ol className={styles.messages}>
        {entries.map((entry) => (
          <li key={entry.id} className={styles.message} data-from={entry.fromSupport ? 'support' : 'you'}>
            <span className={styles.messageMeta}>
              {entry.fromSupport ? t('fromSupport') : t('fromYou')} · <time dateTime={entry.at}>{when(entry.at)}</time>
            </span>
            <p className={styles.bubble}>{entry.content}</p>
          </li>
        ))}
      </ol>

      {ticket.messages.length === 0 ? <p className={styles.waiting}>{t('noReplies')}</p> : null}

      {ticket.status !== 'closed' ? (
        <form className={styles.composer} onSubmit={send}>
          <label className="srOnly" htmlFor={replyId}>
            {t('reply')}
          </label>
          <textarea
            id={replyId}
            className="textarea"
            rows={3}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={t('reply')}
            maxLength={5000}
            required
          />
          <div className={styles.formFoot}>
            {failed ? (
              <p className={styles.error} role="alert">
                {t('notSent')}
              </p>
            ) : null}
            <button className="button buttonPrimary" type="submit" disabled={sending || !reply.trim()}>
              {sending ? t('sending') : t('sendReply')}
            </button>
          </div>
        </form>
      ) : (
        <p className={styles.waiting}>{t('closedNote')}</p>
      )}
    </article>
  );
}
