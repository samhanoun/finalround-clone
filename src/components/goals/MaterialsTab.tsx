'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/browser';
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
  const ids = { file: useId(), title: useId(), kind: useId(), content: useId() };

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
      <form className="card" onSubmit={add}>
        <div className="cardInner stack">
          <div>
            <h2 className="cardTitle">{t('addMaterial')}</h2>
            <p className="help">{t('materialsHelp')}</p>
          </div>
          <div className="row" role="radiogroup" aria-label={t('addMaterial')} style={{ gap: 16 }}>
            <label className="checkbox-label">
              <input type="radio" checked={mode === 'upload'} onChange={() => setMode('upload')} />
              <span>{t('uploadFile')}</span>
            </label>
            <label className="checkbox-label">
              <input type="radio" checked={mode === 'paste'} onChange={() => setMode('paste')} />
              <span>{t('pasteText')}</span>
            </label>
          </div>
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
                className="input"
                type="file"
                accept=".pdf,.docx,.txt,.md,.markdown"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <span className="help">{t('fileHelp')}</span>
            </label>
          ) : (
            <label className="label" htmlFor={ids.content}>
              {t('content')}
              <textarea id={ids.content} className="textarea" rows={8} value={content} onChange={(e) => setContent(e.target.value)} maxLength={60_000} />
            </label>
          )}
          {message ? (
            <p className="help" role={message.kind === 'error' ? 'alert' : 'status'} style={{ margin: 0 }}>
              {message.text}
            </p>
          ) : null}
          <button className="button buttonPrimary" type="submit" disabled={busy || (mode === 'upload' ? !file : !content.trim())}>
            {busy ? t('saving') : t('addMaterial')}
          </button>
        </div>
      </form>

      <section className="card">
        <div className="cardInner stack">
          <h2 className="cardTitle">{t('yourMaterials')}</h2>
          {data.materials.length === 0 ? (
            <p className="help">{t('noMaterialsYet')}</p>
          ) : (
            <ul className={styles.list}>
              {data.materials.map((material) => (
                <li key={material.id} className={styles.listItem}>
                  <button type="button" className={styles.listHead} onClick={() => setOpen(open === material.id ? null : material.id)} aria-expanded={open === material.id}>
                    <span>
                      <strong>{material.title}</strong>
                      <span className={styles.meta}>
                        {t(`kinds.${material.kind}`)} · {t('words', { count: material.content.split(/\s+/).length })} ·{' '}
                        {t('usedBy', { count: usedBy(material.id) })}
                      </span>
                    </span>
                  </button>
                  {open === material.id ? <p className={styles.preview}>{material.content.slice(0, 1500)}</p> : null}
                  <button type="button" className="button buttonGhost" onClick={() => void remove(material)}>
                    {t('delete')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
