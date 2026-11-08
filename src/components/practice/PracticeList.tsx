'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { MoreIcon, PencilIcon, TrashIcon } from '@/components/icons';
import styles from './PracticeList.module.css';

export type PracticeListItem = {
  id: string;
  title: string | null;
  status: string;
  /** The status in the reader's language. */
  statusLabel: string;
  /** The latest report's overall score. */
  score: number | null;
  /** The date, already formatted. */
  date: string;
};

/**
 * Your practice interviews (/interview): each row opens its interview, and a
 * quiet menu at the end of the row renames it or deletes it, with its
 * questions, answers and report, after a confirmation in the row.
 */
export function PracticeList({ items, headingId }: { items: PracticeListItem[]; headingId?: string }) {
  const t = useTranslations('PracticePages');
  const router = useRouter();
  // Shown at once; the server's list (trend, scores) catches up on refresh.
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [renamed, setRenamed] = useState<Readonly<Record<string, string>>>({});
  const [status, setStatus] = useState('');

  return (
    <>
      <p className="srOnly" role="status" aria-live="polite">
        {status}
      </p>
      <ul className={styles.list}>
        {items
          .filter((item) => !removed.has(item.id))
          .map((item) => (
            <PracticeRow
              key={item.id}
              item={item}
              title={renamed[item.id] ?? (item.title || t('interviewTitle'))}
              onRenamed={(title) => {
                setRenamed((current) => ({ ...current, [item.id]: title }));
                setStatus(t('row.renamed', { title }));
                router.refresh();
              }}
              onDeleted={(title) => {
                setRemoved((current) => new Set(current).add(item.id));
                setStatus(t('row.deleted', { title }));
                if (headingId) document.getElementById(headingId)?.focus();
                router.refresh();
              }}
            />
          ))}
      </ul>
    </>
  );
}

type Mode = 'view' | 'rename' | 'confirm';

function PracticeRow(props: {
  item: PracticeListItem;
  title: string;
  onRenamed: (title: string) => void;
  onDeleted: (title: string) => void;
}) {
  const { item, title } = props;
  const t = useTranslations('PracticePages');
  const [mode, setMode] = useState<Mode>('view');
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  // Back on the row after Cancel, Keep or a rename: focus returns to its menu button.
  const returnFocus = useRef(false);

  useEffect(() => {
    if (mode === 'rename') {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (mode === 'confirm') {
      keepRef.current?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      menuButtonRef.current?.focus();
    }
  }, [mode]);

  function backToRow() {
    returnFocus.current = true;
    setMode('view');
    setBusy(false);
  }

  function startRename() {
    setDraft(title);
    setError(null);
    setMode('rename');
  }

  async function rename(event: FormEvent) {
    event.preventDefault();
    const next = draft.trim();
    if (!next || busy) return;
    if (next === title) return backToRow();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/interviews/${item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) throw new Error('rename_failed');
      props.onRenamed(next);
      backToRow();
    } catch {
      setError(t('row.renameFailed'));
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/interviews/${item.id}`, { method: 'DELETE' });
      // Not found: it's already gone, so it leaves the list all the same.
      if (!res.ok && res.status !== 404) throw new Error('delete_failed');
      props.onDeleted(title);
    } catch {
      setError(t('row.deleteFailed'));
      setBusy(false);
    }
  }

  return (
    <li className={styles.row} data-mode={mode}>
      {mode === 'rename' ? (
        <form className={styles.rowForm} onSubmit={rename} aria-label={t('row.renameTitle', { title })}>
          <label className="srOnly" htmlFor={inputId}>
            {t('row.nameLabel')}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            className={`input ${styles.rowInput}`}
            value={draft}
            maxLength={200}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                backToRow();
              }
            }}
            disabled={busy}
          />
          <button className="button buttonSmall" type="submit" disabled={busy || !draft.trim()}>
            {busy ? t('row.saving') : t('row.save')}
          </button>
          <button className="button buttonGhost buttonSmall" type="button" onClick={backToRow} disabled={busy}>
            {t('row.cancel')}
          </button>
        </form>
      ) : mode === 'confirm' ? (
        <div className={styles.rowForm} role="group" aria-label={t('row.deleteTitle', { title })}>
          <p className={styles.confirmText}>{t('row.confirmDelete', { title })}</p>
          <button className="button buttonDanger buttonSmall" type="button" onClick={() => void remove()} disabled={busy}>
            {busy ? t('row.deleting') : t('row.delete')}
          </button>
          <button ref={keepRef} className="button buttonGhost buttonSmall" type="button" onClick={backToRow} disabled={busy}>
            {t('row.keep')}
          </button>
        </div>
      ) : (
        <>
          <Link href={`/interview/${item.id}`} className={styles.rowLink}>
            <span className={styles.rowTitle}>{title}</span>
            <span className={styles.status} data-status={item.status}>
              <span className={styles.statusDot} aria-hidden="true" />
              {item.statusLabel}
            </span>
            <span className={styles.rowScore}>
              {item.score !== null ? (
                <>
                  <span className="srOnly">{t('columns.score')} </span>
                  {item.score}
                </>
              ) : null}
            </span>
            <span className={styles.rowDate}>{item.date}</span>
          </Link>
          <RowMenu
            label={t('row.menu', { title })}
            buttonRef={menuButtonRef}
            onRename={startRename}
            onDelete={() => {
              setError(null);
              setMode('confirm');
            }}
          />
        </>
      )}
      {error ? (
        <p className={styles.rowError} role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** The row's menu: Rename and Delete. Arrow keys move between them; Escape closes it. */
function RowMenu(props: { label: string; buttonRef: RefObject<HTMLButtonElement | null>; onRename: () => void; onDelete: () => void }) {
  const t = useTranslations('PracticePages');
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const { buttonRef } = props;

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const closeOutside = (event: Event) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open, buttonRef]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      items[(next + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(items.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === 'Tab') setOpen(false);
  }

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className={styles.rowMenu}>
      <button
        ref={buttonRef}
        type="button"
        className={`iconButton ${styles.menuButton}`}
        aria-label={props.label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <MoreIcon size={16} />
      </button>
      {open ? (
        <div ref={menuRef} id={menuId} role="menu" aria-label={props.label} className={styles.menu} onKeyDown={onMenuKeyDown}>
          <button type="button" role="menuitem" tabIndex={-1} className={styles.menuItem} onClick={() => choose(props.onRename)}>
            <PencilIcon size={16} />
            {t('row.rename')}
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={`${styles.menuItem} ${styles.menuItemDanger}`}
            onClick={() => choose(props.onDelete)}
          >
            <TrashIcon size={16} />
            {t('row.delete')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
