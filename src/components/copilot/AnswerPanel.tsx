'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnswerView, MAX_FONT_PX, MIN_FONT_PX, type ConnectionState, type TailLine } from './AnswerView';
import { useDocumentPip } from './useDocumentPip';
import { onDesktopCommand } from '@/lib/desktop';
import type { CopilotAnswers } from './useCopilotAnswers';

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
}: {
  answers: CopilotAnswers;
  onAnswerNow: () => void;
  onSolveScreen?: () => void;
  screenDisabled?: boolean;
  disabled: boolean;
  connection: ConnectionState;
  tail: TailLine[];
}) {
  const pip = useDocumentPip();
  const { pipWindow } = pip;
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
    pip.open({ ...WINDOW_SIZE, title: 'Apex Round · Answers' }).catch(() => {
      setPopOutError('The floating window could not open. Click Pop out again.');
    });
  }, [pip]);

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
      actions={
        variant === 'inline' && pip.supported ? (
          <button className="button" type="button" onClick={popOut} title="Keep answers on top of your meeting">
            Pop out
          </button>
        ) : null
      }
    />
  );

  if (pipWindow) {
    return (
      <>
        <section className="card" aria-label="Answer window status">
          <div className="cardInner row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <p className="small" style={{ margin: 0 }}>
              Answers are showing in the floating window, on top of your meeting.
            </p>
            <button className="button" type="button" onClick={pip.close}>
              Bring back here
            </button>
          </div>
        </section>
        {createPortal(view('window'), pipWindow.document.body)}
      </>
    );
  }

  return (
    <>
      {view('inline')}
      {!pip.supported ? (
        <p className="small" style={{ margin: 0 }}>
          A floating answer window needs Chrome or Edge 116 or later. Answers show here instead.
        </p>
      ) : null}
      {popOutError ? (
        <div className="error" role="status">
          {popOutError}
        </div>
      ) : null}
    </>
  );
}
