'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@/i18n/routing';
import { CloseIcon, MenuIcon } from '@/components/icons';
import styles from '../landing.module.css';

type Destination = { href: string; label: string };

/**
 * Phones and narrow windows: the page's links collapse into one menu button,
 * which opens a bottom sheet (a modal dialog, so focus stays inside it).
 */
export function LandingMenu(props: {
  label: string;
  closeLabel: string;
  sections: Destination[];
  account: Destination[];
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  }, []);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`iconButton ${styles.menuButton}`}
        aria-label={props.label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <MenuIcon size={20} />
      </button>
      {open ? <MenuSheet {...props} onClose={close} /> : null}
    </>
  );
}

function MenuSheet({
  label,
  closeLabel,
  sections,
  account,
  onClose,
}: {
  label: string;
  closeLabel: string;
  sections: Destination[];
  account: Destination[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    dialog.addEventListener('close', onClose);
    return () => dialog.removeEventListener('close', onClose);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={styles.sheet}
      aria-label={label}
      onClick={(event) => {
        // The backdrop is the dialog itself; a link closes the sheet and then goes where it points.
        if (event.target === event.currentTarget || (event.target as HTMLElement).closest('a')) ref.current?.close();
      }}
    >
      <div className={styles.sheetHead}>
        <span className={styles.sheetTitle}>{label}</span>
        <button type="button" className="iconButton" aria-label={closeLabel} onClick={() => ref.current?.close()}>
          <CloseIcon size={18} />
        </button>
      </div>
      <nav className={styles.sheetNav} aria-label={label}>
        {sections.map((item) => (
          <a key={item.href} className={styles.sheetLink} href={item.href}>
            {item.label}
          </a>
        ))}
      </nav>
      <div className={styles.sheetAccount}>
        {account.map((item, index) => (
          <Link
            key={item.href}
            className={index === account.length - 1 ? 'button buttonPrimary buttonLarge' : 'button buttonLarge'}
            href={item.href}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </dialog>
  );
}
