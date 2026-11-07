'use client';

import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { splitBullets, splitCodeFences } from '@/lib/copilot/answerText';
import type { CodeArtifact } from '@/lib/copilot/codeArtifacts';
import { ScreenIcon } from '@/components/icons';
import type { CopilotAnswers } from './useCopilotAnswers';
import { CodePanel, DiagramView, HighlightedCode, WithSourceMarks } from './RichAnswer';
import styles from './AnswerView.module.css';

export type ConnectionState = { label: string; tone: 'live' | 'warn' | 'off' };
export type TailLine = { speaker: 'interviewer' | 'candidate'; text: string; live?: boolean };

export const MIN_FONT_PX = 13;
export const MAX_FONT_PX = 26;

/**
 * Prose as text, fenced code as highlighted code, ```diagram as a drawing;
 * partial while the answer streams. With `lead`, an answer that opens with a
 * sentence sets it large: the line to say first.
 */
export function AnswerBody({ text, lead = false }: { text: string; lead?: boolean }) {
  const segments = useMemo(() => splitCodeFences(text), [text]);
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'code' ? (
          segment.lang === 'diagram' ? (
            segment.open ? null : <DiagramView key={index} source={segment.code} />
          ) : (
            <HighlightedCode key={index} code={segment.code} lang={segment.lang} className={styles.code} />
          )
        ) : (
          <div key={index} className={styles.prose}>
            {splitBullets(segment.text).map((block, blockIndex) =>
              block.kind === 'points' ? (
                <ul key={blockIndex} className={styles.points}>
                  {block.items.map((item, itemIndex) => (
                    <li key={itemIndex}>
                      <WithSourceMarks text={item} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p key={blockIndex} className={lead && index === 0 && blockIndex === 0 ? `${styles.line} ${styles.opening}` : styles.line}>
                  <WithSourceMarks text={block.text} />
                </p>
              ),
            )}
          </div>
        ),
      )}
    </>
  );
}

/**
 * The answer as the candidate reads it mid-interview, set like a prompter:
 * the question in the interviewer's colour, the opening line large, the
 * points below, and the controls in one toolbar. Rendered in the page or in
 * the floating window (which also shows the last few lines of conversation).
 */
export function AnswerView({
  answers,
  onAnswerNow,
  disabled,
  variant,
  connection,
  tail,
  fontPx,
  onFontPx,
  actions,
  onSolveScreen,
  screenDisabled = false,
  codeArtifacts = [],
  autoScreen,
  mobileBar = false,
}: {
  answers: CopilotAnswers;
  onAnswerNow: () => void;
  disabled: boolean;
  variant: 'inline' | 'window';
  connection: ConnectionState;
  tail: TailLine[];
  fontPx: number;
  onFontPx: (px: number) => void;
  /** Extra toolbar buttons (Pop out). */
  actions?: ReactNode;
  /** Solve screen: answer from a frame of the shared tab or screen. */
  onSolveScreen?: () => void;
  screenDisabled?: boolean;
  /** Code from this session's answers, with versions (the code panel). */
  codeArtifacts?: CodeArtifact[];
  /** Automatic Solve screen switch. */
  autoScreen?: { on: boolean; onToggle: (on: boolean) => void };
  /** Phones: Answer now and Solve screen live in the page's bottom bar instead. */
  mobileBar?: boolean;
}) {
  const t = useTranslations('Answer');
  // Subscribes here, not in the page, so streamed text only re-renders this view.
  const state = useSyncExternalStore(answers.subscribe, answers.getState, answers.getState);
  const { question } = state;
  const waitingForText = state.status === 'answering' && !state.text;
  const [tab, setTab] = useState<'answer' | 'code'>('answer');
  const showCode = tab === 'code' && codeArtifacts.length > 0;
  const versions = codeArtifacts.reduce((sum, artifact) => sum + artifact.revisions.length, 0);
  const classes = [styles.view, variant === 'window' ? styles.window : styles.inline, mobileBar ? styles.withMobileBar : ''];

  return (
    <section className={classes.join(' ')} aria-label={t('label')} style={{ ['--answer-font' as string]: `${fontPx}px` }}>
      <header className={styles.status}>
        <span className={styles.connection} data-tone={connection.tone} role="status" aria-live="polite">
          {connection.label}
        </span>
        <span className={styles.answerStatus}>
          {t(`status.${state.status}`)}
          {state.status === 'answered' && state.ttftMs != null ? ` · ${t('firstWords', { ms: state.ttftMs })}` : ''}
        </span>
      </header>

      <div className={styles.body}>
        {codeArtifacts.length > 0 ? (
          <div className={styles.viewTabs} role="tablist" aria-label={t('views')}>
            <button type="button" role="tab" aria-selected={!showCode} className={styles.viewTab} onClick={() => setTab('answer')}>
              {t('answerTab')}
            </button>
            <button type="button" role="tab" aria-selected={showCode} className={styles.viewTab} onClick={() => setTab('code')}>
              {t('codeTab', { count: versions })}
            </button>
          </div>
        ) : null}

        {showCode ? (
          <CodePanel artifacts={codeArtifacts} />
        ) : (
          <>
            {question ? (
              <div className={styles.question}>
                <p className={styles.kicker} data-voice="interviewer">
                  {question.via === 'screen' ? t('screen') : t(`category.${question.category}`)}
                </p>
                <p className={styles.questionText}>{question.via === 'screen' ? t('screenQuestion') : question.text}</p>
                {state.superseded > 0 && variant === 'inline' ? (
                  <p className={styles.superseded}>{t('superseded', { count: state.superseded })}</p>
                ) : null}
              </div>
            ) : (
              <p className={styles.empty}>
                {connection.tone === 'off' ? t('emptyNotListening') : t.rich('empty', { kbd: (chunks) => <kbd>{chunks}</kbd> })}
              </p>
            )}

            {state.text || waitingForText ? (
              <div className={styles.answerBlock}>
                <p className={styles.kicker} data-voice="you" aria-hidden="true">
                  {t('suggested')}
                </p>
                <div className={styles.answer} role="group" aria-label={t('suggested')} aria-busy={state.status === 'answering'}>
                  {state.text ? <AnswerBody text={state.text} lead /> : <span className={styles.waiting}>{t('writing')}</span>}
                </div>
              </div>
            ) : null}

            {state.status === 'answered' && state.sources.length > 0 ? (
              <p className={styles.sources}>
                <span>{t('sources')}</span>
                {state.sources.map((source) => (
                  <span key={source.tag} className={styles.source}>
                    <span className={styles.sourceTag}>{source.tag.slice(1)}</span>
                    {source.kind === 'memory' ? t('memory') : source.kind === 'resume' ? t('resume') : source.source}
                  </span>
                ))}
              </p>
            ) : null}
          </>
        )}

        {state.error ? (
          <div className="error" role="status">
            {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : t('errors.unknown')}
          </div>
        ) : null}

        {variant === 'window' && tail.length > 0 && !showCode ? (
          <ol className={styles.tail} aria-label={t('latest')}>
            {tail.map((line, index) => (
              <li
                key={`${index}-${line.speaker}`}
                className={line.live ? styles.liveLine : undefined}
                data-voice={line.speaker === 'interviewer' ? 'interviewer' : 'you'}
              >
                <span className={styles.speaker}>{line.speaker === 'interviewer' ? t('interviewer') : t('you')}</span>
                <span>{line.text}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      <div className={styles.toolbar} role="group" aria-label={t('controls')}>
        <span className={styles.primaryControls}>
          <button className="button buttonPrimary" type="button" onClick={onAnswerNow} disabled={disabled}>
            {t('answerNow')}
          </button>
          {onSolveScreen ? (
            <button className="button" type="button" onClick={onSolveScreen} disabled={disabled || screenDisabled} title={t('solveScreenTitle')}>
              <ScreenIcon size={16} className={styles.buttonIcon} />
              {t('solveScreen')}
            </button>
          ) : null}
        </span>
        {onSolveScreen && autoScreen ? (
          <label className={styles.auto} title={t('autoScreenHelp')}>
            <input type="checkbox" checked={autoScreen.on} onChange={(e) => autoScreen.onToggle(e.target.checked)} />
            <span>{t('autoScreen')}</span>
          </label>
        ) : null}
        {state.status === 'answering' ? (
          <button className="button buttonGhost" type="button" onClick={answers.stop}>
            {t('stop')}
          </button>
        ) : null}
        <span className={styles.toolbarEnd}>
          <span className={styles.fontControls} role="group" aria-label={t('textSize')}>
            <button
              className={styles.fontButton}
              type="button"
              onClick={() => onFontPx(fontPx - 1)}
              disabled={fontPx <= MIN_FONT_PX}
              aria-label={t('smaller')}
              title={t('smaller')}
            >
              A−
            </button>
            <button
              className={styles.fontButton}
              type="button"
              onClick={() => onFontPx(fontPx + 1)}
              disabled={fontPx >= MAX_FONT_PX}
              aria-label={t('larger')}
              title={t('larger')}
            >
              A+
            </button>
          </span>
          {actions}
        </span>
        {variant === 'window' ? <p className={styles.hint}>{onSolveScreen ? t('windowKeysScreen') : t('windowKeys')}</p> : null}
      </div>
    </section>
  );
}
