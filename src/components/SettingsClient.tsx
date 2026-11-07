'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ANSWER_LENGTHS,
  ANSWER_LENGTH_IDS,
  ANSWER_STYLE_IDS,
  type ModelOption,
  type ModelSettings,
} from '@/lib/answerStyle';
import {
  GroupFooter,
  SaveNote,
  Segmented,
  SettingRow,
  SettingsGroup,
  settingsStyles as styles,
  type SaveState,
} from '@/app/[locale]/settings/SettingsUI';

type Props = {
  initial: ModelSettings;
  options: ModelOption[];
  /** The server's own choices, used when the user picks "default". */
  defaults: { answer: string; coding: string; codingIsSeparate: boolean };
};

function labelFor(options: ModelOption[], id: string) {
  return options.find((option) => option.id === id)?.label ?? id;
}

/** Settings → Answers: the models and how they write. Saved per account; new live sessions pick it up when they start. */
export function SettingsClient({ initial, options, defaults }: Props) {
  const t = useTranslations('AnswerModel');
  // Known models have their own note in each language; others were added by the server.
  const noteFor = (option: ModelOption) => (t.has(`modelNotes.${option.id}`) ? t(`modelNotes.${option.id}`) : t('modelNotes.server'));
  const [baseline, setBaseline] = useState<ModelSettings>(initial);
  const [answerModel, setAnswerModel] = useState(initial.answerModel ?? '');
  const [codingModel, setCodingModel] = useState(initial.codingModel ?? '');
  const [style, setStyle] = useState(initial.style);
  const [length, setLength] = useState(initial.length);
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  const ids = { answer: useId(), coding: useId(), style: useId(), styleHelp: useId(), length: useId(), lengthHelp: useId(), name: useId() };

  const unavailable = options.length === 0;
  const selectedAnswer = options.find((option) => option.id === answerModel);
  const selectedCoding = options.find((option) => option.id === codingModel);
  const codingDefaultLabel = defaults.codingIsSeparate
    ? t('serverDefault', { model: labelFor(options, defaults.coding) })
    : t('sameAsAnswer');
  const dirty =
    answerModel !== (baseline.answerModel ?? '') ||
    codingModel !== (baseline.codingModel ?? '') ||
    style !== baseline.style ||
    length !== baseline.length;

  function edit<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      if (state !== 'saving') setState('idle');
    };
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty || unavailable) return;
    setState('saving');
    setError(null);
    const next: ModelSettings = { answerModel: answerModel || null, codingModel: codingModel || null, style, length };
    try {
      const res = await fetch('/api/settings/llm', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error === 'model_unavailable' ? t('modelUnavailable') : t('saveFailed'));
      setBaseline(next);
      setState('saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveFailed'));
      setState('error');
    }
  }

  if (unavailable) {
    return (
      <SettingsGroup label={t('label')}>
        <div className={styles.block}>
          <p className={styles.rowHelp} role="status">
            {t('unavailable')}
          </p>
        </div>
      </SettingsGroup>
    );
  }

  return (
    <form className={styles.group} aria-label={t('label')} onSubmit={save}>
      <SettingRow label={t('answers')} htmlFor={ids.answer} help={selectedAnswer ? noteFor(selectedAnswer) : t('chosenByServer')}>
        <select className="select" id={ids.answer} value={answerModel} onChange={(e) => edit(setAnswerModel)(e.target.value)}>
          <option value="">{t('serverDefault', { model: labelFor(options, defaults.answer) })}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </SettingRow>

      <SettingRow label={t('coding')} htmlFor={ids.coding} help={selectedCoding ? noteFor(selectedCoding) : t('codingHelp')}>
        <select className="select" id={ids.coding} value={codingModel} onChange={(e) => edit(setCodingModel)(e.target.value)}>
          <option value="">{codingDefaultLabel}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </SettingRow>

      <SettingRow label={t('style')} labelId={ids.style} helpId={ids.styleHelp} help={t(`styles.${style}.note`)}>
        <Segmented
          name={`${ids.name}-style`}
          value={style}
          label={t('styleLabel')}
          describedBy={ids.styleHelp}
          options={ANSWER_STYLE_IDS.map((id) => ({ value: id, label: t(`styles.${id}.label`) }))}
          onChange={edit(setStyle)}
        />
      </SettingRow>

      <SettingRow
        label={t('length')}
        labelId={ids.length}
        helpId={ids.lengthHelp}
        help={t('aboutWords', { words: ANSWER_LENGTHS[length].words })}
      >
        <Segmented
          name={`${ids.name}-length`}
          value={length}
          label={t('lengthLabel')}
          describedBy={ids.lengthHelp}
          options={ANSWER_LENGTH_IDS.map((id) => ({ value: id, label: t(`lengths.${id}`) }))}
          onChange={edit(setLength)}
        />
      </SettingRow>

      <GroupFooter note={t('nextSession')}>
        <SaveNote state={state} saved={t('saved')} error={error} />
        <button className="button buttonPrimary" type="submit" disabled={!dirty || state === 'saving'}>
          {state === 'saving' ? t('saving') : t('save')}
        </button>
      </GroupFooter>
    </form>
  );
}
