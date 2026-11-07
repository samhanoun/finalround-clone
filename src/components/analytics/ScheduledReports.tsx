'use client';

import { useEffect, useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  REPORT_FREQUENCIES,
  REPORT_TYPES,
  type ReportFrequency,
  type ReportType,
} from '@/lib/analyticsReportTypes';
import styles from './ScheduledReports.module.css';

type Report = {
  id: string;
  report_type: ReportType;
  frequency: ReportFrequency;
  enabled: boolean;
  last_sent_at: string | null;
  next_send_at: string;
};

/** Analytics → Reports: email reports on a schedule, sent to the account's address. */
export function ScheduledReports() {
  const t = useTranslations('Reports');
  const format = useFormatter();
  const when = (iso: string | null) =>
    iso
      ? format.dateTime(new Date(iso), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
      : t('notYet');
  const [reports, setReports] = useState<Report[] | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [type, setType] = useState<ReportType>('summary');
  const [frequency, setFrequency] = useState<ReportFrequency>('weekly');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const ids = { type: useId(), typeHelp: useId(), frequency: useId() };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch('/api/analytics/reports').catch(() => null);
      const data = res?.ok ? await res.json().catch(() => null) : null;
      if (cancelled) return;
      if (!data) {
        setMessage({ kind: 'error', text: t('loadFailed') });
        setReports([]);
        return;
      }
      setReports(data.reports);
      setEmail(data.email);
      setEmailConfigured(Boolean(data.emailConfigured));
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function call(key: string, input: RequestInfo, init: RequestInit, done: string) {
    setBusy(key);
    setMessage(null);
    try {
      const res = await fetch(input, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' && t.has(`errors.${data.error}`) ? t(`errors.${data.error}`) : t('failed'));
      }
      setMessage({ kind: 'ok', text: done });
      return data;
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : t('failed') });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const data = await call(
      'create',
      '/api/analytics/reports',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ report_type: type, frequency }) },
      t('scheduled'),
    );
    if (data?.report) setReports((current) => [...(current ?? []), data.report]);
  }

  async function toggle(report: Report) {
    const data = await call(
      report.id,
      '/api/analytics/reports',
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: report.id, enabled: !report.enabled }) },
      report.enabled ? t('paused') : t('resumed'),
    );
    if (data?.report) setReports((current) => (current ?? []).map((r) => (r.id === report.id ? data.report : r)));
  }

  async function remove(report: Report) {
    const data = await call(report.id, `/api/analytics/reports?id=${report.id}`, { method: 'DELETE' }, t('deleted'));
    if (data) setReports((current) => (current ?? []).filter((r) => r.id !== report.id));
  }

  async function sendNow(report: Report) {
    await call(
      report.id,
      '/api/analytics/reports/send',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: report.id }) },
      email ? t('sentTo', { email }) : t('sentToAccount'),
    );
  }

  return (
    <section className={styles.section} aria-labelledby="reports-title">
      <div className={styles.head}>
        <h2 className={styles.title} id="reports-title">
          {t('title')}
        </h2>
        <p className={styles.desc}>
          {emailConfigured ? (email ? t('sentAt', { email }) : t('sentAtAccount')) : t('emailUnconfigured')}
        </p>
      </div>

      <form className={`card ${styles.form}`} onSubmit={create}>
        <div className={styles.field}>
          <label className="label" htmlFor={ids.type}>
            {t('report')}
          </label>
          <select
            id={ids.type}
            className="select"
            value={type}
            onChange={(e) => setType(e.target.value as ReportType)}
            aria-describedby={ids.typeHelp}
          >
            {REPORT_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`types.${value}.label`)}
              </option>
            ))}
          </select>
          <span className="help" id={ids.typeHelp}>
            {t(`types.${type}.help`)}
          </span>
        </div>
        <div className={styles.field}>
          <label className="label" htmlFor={ids.frequency}>
            {t('howOften')}
          </label>
          <select
            id={ids.frequency}
            className="select"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as ReportFrequency)}
          >
            {REPORT_FREQUENCIES.map((value) => (
              <option key={value} value={value}>
                {t(`frequencies.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={`button buttonPrimary ${styles.submit}`} disabled={busy !== null || reports === null}>
          {busy === 'create' ? t('scheduling') : t('schedule')}
        </button>
      </form>

      {message ? (
        <p className={styles.message} data-kind={message.kind} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      ) : null}

      <div className={styles.listBlock}>
        <h3 className={styles.listTitle}>{t('scheduledTitle')}</h3>
        {reports === null ? (
          <p className={styles.note}>{t('loading')}</p>
        ) : reports.length === 0 ? (
          <div className="emptyState">
            <p className={styles.emptyText}>{t('empty')}</p>
          </div>
        ) : (
          <ul className={`card ${styles.list}`}>
            {reports.map((report) => (
              <li key={report.id} className={styles.item}>
                <div className={styles.itemText}>
                  <span className={styles.itemTitle}>{t(`types.${report.report_type}.label`)}</span>
                  <span className={styles.itemMeta}>
                    <span className={styles.state} data-enabled={report.enabled}>
                      <span className="dot" aria-hidden="true" />
                      {t(`frequencies.${report.frequency}`)}
                    </span>
                    <span>{report.enabled ? t('next', { when: when(report.next_send_at) }) : t('pausedState')}</span>
                    <span>{t('lastSent', { when: when(report.last_sent_at) })}</span>
                  </span>
                </div>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className="button buttonSmall"
                    disabled={busy !== null || !emailConfigured}
                    onClick={() => void sendNow(report)}
                  >
                    {t('sendNow')}
                  </button>
                  <button type="button" className="button buttonGhost buttonSmall" disabled={busy !== null} onClick={() => void toggle(report)}>
                    {report.enabled ? t('pause') : t('resume')}
                  </button>
                  <button type="button" className="button buttonGhost buttonSmall" disabled={busy !== null} onClick={() => void remove(report)}>
                    {t('delete')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
