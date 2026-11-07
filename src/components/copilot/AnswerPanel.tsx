'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { addRevision, type CodeArtifact } from '@/lib/copilot/codeArtifacts';
import { AnswerView, MAX_FONT_PX, MIN_FONT_PX, type ConnectionState, type TailLine } from './AnswerView';
import { useDocumentPip } from './useDocumentPip';
import { onDesktopCommand } from '@/lib/desktop';
import { ExternalIcon } from '@/components/icons';
import type { CopilotAnswers } from './useCopilotAnswers';
import styles from './AnswerPanel.module.css';

const FONT_STORAGE_KEY = 'apex.answerFontPx';
const DEFAULT_FONT_PX = 16;
const WINDOW_SIZE = { width: 420, height: 620 };

function storedFontPx(): number {
  try {
    const value = Number(window.localStorage.getItem(FONT_STORAGE_KEY));
    return value >= MIN_FONT_PX && value <= MAX_FONT_PX ? value : DEFAULT_FONT_PX;
  } catch {
    return DEFAULT_FONT_PX;
  }
}

function isInteractive(target: EventTarget | null): boolean {
  const element = target as Element | null;
  return typeof element?.closest === 'function' && element.closest('button, input, textarea, select, a') !== null;
}

/** Code from this session's answers, versioned per problem (the code panel). */
function useCodeArtifacts(answers: CopilotAnswers): CodeArtifact[] {
  const [artifacts, setArtifacts] = useState<CodeArtifact[]>([]);
  useEffect(() => {
    let lastSeen: unknown = null;
    return answers.subscribe(() => {
      const state = answers.getState();
      if (state.status !== 'answered' || !state.question || state === lastSeen) return;
      lastSeen = state;
      const question = state.question;
      setArtifacts((current) => addRevision(current, question, state.text, Date.now()));
    });
  }, [answers]);
  return artifacts;
}

/**
 * Where answers show during a session: in the page, or popped out into an
 * always-on-top Picture-in-Picture window so the meeting tab can stay in front.
 */
export function AnswerPanel({
  answers,
  onAnswerNow,
  onSolveScreen,
  screenDisabled,
  disabled,
  connection,
  tail,
  autoScreen,
  mobileBar = false,
}: {
  answers: CopilotAnswers;
  onAnswerNow: () => void;
  onSolveScreen?: () => void;
  screenDisabled?: boolean;
  disabled: boolean;
  connection: ConnectionState;
  tail: TailLine[];
  /** Automatic Solve screen switch. */
  autoScreen?: { on: boolean; onToggle: (on: boolean) => void };
  /** Phones: the page has a bottom bar with Answer now and Solve screen. */
  mobileBar?: boolean;
}) {
  const t = useTranslations('AnswerPanel');
  const pip = useDocumentPip();
  const { pipWindow } = pip;
  const codeArtifacts = useCodeArtifacts(answers);
  // Only mounted on the client during a session, so reading storage here can't break hydration.
  const [fontPx, setFontPx] = useState(storedFontPx);
  const [popOutError, setPopOutError] = useState<string | null>(null);

  const changeFont = useCallback((px: number) => {
    setFontPx(Math.min(MAX_FONT_PX, Math.max(MIN_FONT_PX, px)));
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(FONT_STORAGE_KEY, String(fontPx));
    } catch {
      // storage unavailable (private mode); the size just won't be remembered
    }
  }, [fontPx]);

  // Shortcuts while the floating window has focus.
  const stop = answers.stop;
  useEffect(() => {
    if (!pipWindow) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'a' || (event.key === ' ' && !isInteractive(event.target))) {
        event.preventDefault();
        onAnswerNow();
      } else if (key === 's' && onSolveScreen && !disabled && !screenDisabled) {
        event.preventDefault();
        onSolveScreen();
      } else if (event.key === 'Escape') {
        stop();
      } else if (event.key === '+' || event.key === '=') {
        setFontPx((px) => Math.min(MAX_FONT_PX, px + 1));
      } else if (event.key === '-' || event.key === '_') {
        setFontPx((px) => Math.max(MIN_FONT_PX, px - 1));
      }
    };
    pipWindow.document.addEventListener('keydown', onKeyDown);
    return () => pipWindow.document.removeEventListener('keydown', onKeyDown);
  }, [pipWindow, onAnswerNow, onSolveScreen, disabled, screenDisabled, stop]);

  const popOut = useCallback(() => {
    setPopOutError(null);
    pip.open({ ...WINDOW_SIZE, title: t('windowTitle') }).catch(() => {
      setPopOutError(t('popOutFailed'));
    });
  }, [pip, t]);

  // Desktop app: Ctrl+Shift+H pops the answers out or brings them back. The
  // shortcut arrives with a user gesture, which opening the window needs.
  const closePip = pip.close;
  useEffect(
    () =>
      onDesktopCommand((command) => {
        if (command !== 'toggle-answers') return;
        if (pipWindow) closePip();
        else popOut();
      }),
    [pipWindow, closePip, popOut],
  );

  const view = (variant: 'inline' | 'window') => (
    <AnswerView
      answers={answers}
      onAnswerNow={onAnswerNow}
      onSolveScreen={onSolveScreen}
      screenDisabled={screenDisabled}
      disabled={disabled}
      variant={variant}
      connection={connection}
      tail={tail}
      fontPx={fontPx}
      onFontPx={changeFont}
      codeArtifacts={codeArtifacts}
      autoScreen={autoScreen}
      mobileBar={variant === 'inline' && mobileBar}
      actions={
        variant === 'inline' && pip.supported ? (
          <button className="button buttonGhost" type="button" onClick={popOut} title={t('popOutTitle')}>
            <ExternalIcon size={16} className={styles.icon} />
            {t('popOut')}
          </button>
        ) : null
      }
    />
  );

  if (pipWindow) {
    return (
      <>
        <section className={styles.popped} aria-label={t('statusLabel')}>
          <p className={styles.poppedText}>{t('inWindow')}</p>
          <button className="button" type="button" onClick={pip.close}>
            {t('bringBack')}
          </button>
        </section>
        {createPortal(view('window'), pipWindow.document.body)}
      </>
    );
  }

  return (
    <>
      {view('inline')}
      {!pip.supported ? <p className={styles.note}>{t('noPip')}</p> : null}
      {popOutError ? (
        <div className="error" role="status">
          {popOutError}
        </div>
      ) : null}
    </>
  );
}
