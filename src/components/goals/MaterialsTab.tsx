'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/browser';
import { ChevronDownIcon } from '@/components/icons';
import { Segmented } from '@/components/practice/Controls';
import { MATERIAL_KINDS, type Material, type MaterialKind } from '@/lib/goalTypes';
import type { WorkspaceData } from './GoalsWorkspace';
import styles from './Goals.module.css';

const UPLOAD_ERRORS = ['unsupported_type', 'too_large', 'unreadable', 'empty', 'rate_limited'] as const;

/** Materials: notes, project write-ups and company research the copilot can quote, with the source shown. */
export function MaterialsTab({ data, reload }: { data: WorkspaceData; reload: () => Promise<void> }) {
  const t = useTranslations('Goals');
  const [mode, setMode] = useState<'upload' | 'paste'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<MaterialKind>('notes');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const ids = { file: useId(), fileHelp: useId(), title: useId(), kind: useId(), content: useId(), heading: useId(), list: useId() };

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (mode === 'upload') {
        if (!file) return;
        const form = new FormData();
        form.set('file', file);
        form.set('kind', kind);
        if (title.trim()) form.set('title', title.trim());
        const res = await fetch('/api/materials/upload', { method: 'POST', body: form });
        if (!res.ok) {
          const error = (await res.json().catch(() => ({})))?.error;
          throw new Error(UPLOAD_ERRORS.includes(error) ? t(`uploadErrors.${error}`) : t('saveFailed'));
        }
      } else {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        const { error } = await supabase
          .from('materials')
          .insert({ user_id: user.id, title: title.trim() || t('untitledMaterial'), kind, content: content.trim().slice(0, 60_000) });
        if (error) throw new Error(t('saveFailed'));
      }
      setFile(null);
      setTitle('');
      setContent('');
      setMessage({ kind: 'ok', text: t('materialAdded') });
      await reload();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : t('saveFailed') });
    } finally {
      setBusy(false);
    }
  }

  async function remove(material: Material) {
    if (!window.confirm(t('confirmDeleteMaterial', { title: material.title }))) return;
    await createClient().from('materials').delete().eq('id', material.id);
    await reload();
  }

  const usedBy = (id: string) => data.goals.filter((goal) => goal.material_ids.includes(id)).length;

  return (
    <div className={styles.split}>
      <section className={styles.listPane} aria-labelledby={ids.list}>
        <h2 className={styles.paneTitle} id={ids.list}>
          {t('yourMaterials')}
          <span className={styles.paneCount}>{data.materials.length}</span>
        </h2>
        {data.materials.length === 0 ? (
          <p className={`emptyState ${styles.empty}`}>{t('noMaterialsYet')}</p>
        ) : (
          <ul className={styles.rows}>
            {data.materials.map((material) => {
              const expanded = open === material.id;
              return (
                <li key={material.id} className={styles.row}>
                  <button
                    type="button"
                    className={styles.rowHead}
                    onClick={() => setOpen(expanded ? null : material.id)}
                    aria-expanded={expanded}
                  >
                    <span className={styles.rowTitle}>{material.title}</span>
                    <span className={styles.rowMeta}>
                      <span>{t(`kinds.${material.kind}`)}</span>
                      <span>{t('words', { count: material.content.split(/\s+/).filter(Boolean).length })}</span>
                      <span>{t('usedBy', { count: usedBy(material.id) })}</span>
                    </span>
                    <ChevronDownIcon size={16} className={styles.rowChevron} />
                  </button>
                  <div className={styles.rowActions}>
                    <button type="button" className="button buttonGhost buttonSmall" onClick={() => void remove(material)}>
                      {t('delete')}
                    </button>
                  </div>
                  {expanded ? <p className={styles.preview}>{material.content.slice(0, 1500)}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <form className={styles.sidePanel} onSubmit={add} aria-labelledby={ids.heading}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle} id={ids.heading}>
            {t('addMaterial')}
          </h2>
          <p className={styles.help}>{t('materialsHelp')}</p>
        </div>
        <Segmented
          label={t('addMaterial')}
          hideLabel
          options={[
            { value: 'upload' as const, label: t('uploadFile') },
            { value: 'paste' as const, label: t('pasteText') },
          ]}
          value={mode}
          onChange={setMode}
        />
        <label className="label" htmlFor={ids.title}>
          {t('materialTitle')}
          <input id={ids.title} className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </label>
        <label className="label" htmlFor={ids.kind}>
          {t('materialKind')}
          <select id={ids.kind} className="select" value={kind} onChange={(e) => setKind(e.target.value as MaterialKind)}>
            {MATERIAL_KINDS.map((value) => (
              <option key={value} value={value}>
                {t(`kinds.${value}`)}
              </option>
            ))}
          </select>
        </label>
        {mode === 'upload' ? (
          <label className="label" htmlFor={ids.file}>
            {t('file')}
            <input
              id={ids.file}
              className={styles.file}
              type="file"
              accept=".pdf,.docx,.txt,.md,.markdown"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              aria-describedby={ids.fileHelp}
            />
            <span id={ids.fileHelp} className="help">
              {t('fileHelp')}
            </span>
          </label>
        ) : (
          <label className="label" htmlFor={ids.content}>
            {t('content')}
            <textarea id={ids.content} className="textarea" rows={8} value={content} onChange={(e) => setContent(e.target.value)} maxLength={60_000} />
          </label>
        )}
        {message ? (
          <p className={message.kind === 'error' ? styles.formError : styles.notice} role={message.kind === 'error' ? 'alert' : 'status'}>
            {message.text}
          </p>
        ) : null}
        <button className="button buttonPrimary" type="submit" disabled={busy || (mode === 'upload' ? !file : !content.trim())}>
          {busy ? t('saving') : t('addMaterial')}
        </button>
      </form>
    </div>
  );
}
