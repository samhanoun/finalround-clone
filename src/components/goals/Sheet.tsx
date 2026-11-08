'use client';

import { useEffect, useId, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { CloseIcon } from '@/components/icons';
import styles from './Goals.module.css';

/**
 * An editor that slides over the page: a drawer from the right on wide
 * screens, a bottom sheet on phones. It's a modal dialog, so focus stays
 * inside and Escape closes it. `onClose` runs however it closes.
 */
export function Sheet(props: {
  title: string;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations('Goals');
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // A click that started inside (selecting text) and ended on the backdrop isn't a backdrop click.
  const pressedBackdrop = useRef(false);
  const { onClose } = props;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    const close = () => onClose();
    dialog.addEventListener('close', close);
    return () => dialog.removeEventListener('close', close);
  }, [onClose]);

  const close = () => {
    const dialog = ref.current;
    if (dialog && typeof dialog.close === 'function') dialog.close();
    else onClose();
  };

  return (
    <dialog
      ref={ref}
      className={styles.sheet}
      aria-labelledby={titleId}
      onMouseDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressedBackdrop.current) close();
      }}
    >
      <form className={styles.sheetForm} onSubmit={props.onSubmit}>
        <header className={styles.sheetHeader}>
          <h2 className={styles.sheetTitle} id={titleId}>
            {props.title}
          </h2>
          <button type="button" className="iconButton" aria-label={t('close')} onClick={close}>
            <CloseIcon size={18} />
          </button>
        </header>
        <div className={styles.sheetBody}>{props.children}</div>
        <footer className={styles.sheetFooter}>{props.footer}</footer>
      </form>
    </dialog>
  );
}
