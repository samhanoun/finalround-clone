'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useToastHook } from '@/components/Toast';
import {
  ANSWER_LENGTHS,
  ANSWER_LENGTH_IDS,
  ANSWER_STYLE_IDS,
  type ModelOption,
  type ModelSettings,
} from '@/lib/answerStyle';

type Props = {
  initial: ModelSettings;
  options: ModelOption[];
  /** The server's own choices, used when the user picks "default". */
  defaults: { answer: string; coding: string; codingIsSeparate: boolean };
};

function labelFor(options: ModelOption[], id: string) {
  return options.find((option) => option.id === id)?.label ?? id;
}

/** Settings → Answer model. Saved per account; new live sessions pick it up when they start. */
export function SettingsClient({ initial, options, defaults }: Props) {
  const t = useTranslations('AnswerModel');
  // Known models have their own note in each language; others were added by the server.
  const noteFor = (option: ModelOption) => (t.has(`modelNotes.${option.id}`) ? t(`modelNotes.${option.id}`) : t('modelNotes.server'));
  const [answerModel, setAnswerModel] = useState(initial.answerModel ?? '');
  const [codingModel, setCodingModel] = useState(initial.codingModel ?? '');
  const [style, setStyle] = useState(initial.style);
  const [length, setLength] = useState(initial.length);
  const [saving, setSaving] = useState(false);
  const toast = useToastHook();

  const answerId = useId();
  const codingId = useId();
  const styleName = useId();
  const lengthName = useId();

  const unavailable = options.length === 0;
  const selectedAnswer = options.find((option) => option.id === answerModel);
  const selectedCoding = options.find((option) => option.id === codingModel);
  const codingDefaultLabel = defaults.codingIsSeparate
    ? t('serverDefault', { model: labelFor(options, defaults.coding) })
    : t('sameAsAnswer');

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/llm', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answerModel: answerModel || null,
          codingModel: codingModel || null,
          style,
          length,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error === 'model_unavailable' ? t('modelUnavailable') : t('saveFailed'));
      toast.success(t('savedTitle'), t('savedBody'));
    } catch (e) {
      toast.error(t('notSavedTitle'), e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" role="form" aria-label={t('label')}>
      <div className="cardInner stack">
        <h2 className="cardTitle" id="settings-title">{t('title')}</h2>
        <p className="cardDesc">{t('desc')}</p>

        {unavailable ? (
          <p className="help" role="status">
            {t('unavailable')}
          </p>
        ) : (
          <>
            <div className="grid2">
              <label className="label" htmlFor={answerId}>
                {t('answers')}
                <select className="select" id={answerId} value={answerModel} onChange={(e) => setAnswerModel(e.target.value)}>
                  <option value="">{t('serverDefault', { model: labelFor(options, defaults.answer) })}</option>
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="help">{selectedAnswer ? noteFor(selectedAnswer) : t('chosenByServer')}</span>
              </label>

              <label className="label" htmlFor={codingId}>
                {t('coding')}
                <select className="select" id={codingId} value={codingModel} onChange={(e) => setCodingModel(e.target.value)}>
                  <option value="">{codingDefaultLabel}</option>
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="help">{selectedCoding ? noteFor(selectedCoding) : t('codingHelp')}</span>
              </label>
            </div>

            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
              <legend className="label">{t('style')}</legend>
              <div className="row" role="radiogroup" aria-label={t('styleLabel')}>
                {ANSWER_STYLE_IDS.map((id) => (
                  <label key={id} className="checkbox-label">
                    <input type="radio" name={styleName} value={id} checked={style === id} onChange={() => setStyle(id)} />
                    <span>
                      {t(`styles.${id}.label`)}
                      <span className="help"> · {t(`styles.${id}.note`)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
              <legend className="label">{t('length')}</legend>
              <div className="row" role="radiogroup" aria-label={t('lengthLabel')}>
                {ANSWER_LENGTH_IDS.map((id) => (
                  <label key={id} className="checkbox-label">
                    <input type="radio" name={lengthName} value={id} checked={length === id} onChange={() => setLength(id)} />
                    <span>
                      {t(`lengths.${id}`)}
                      <span className="help"> · {t('aboutWords', { words: ANSWER_LENGTHS[id].words })}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <p className="help">{t('nextSession')}</p>
          </>
        )}

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="button buttonPrimary" onClick={save} disabled={saving || unavailable} type="button">
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
