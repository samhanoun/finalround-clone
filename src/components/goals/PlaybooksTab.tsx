'use client';

import { useCallback, useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/browser';
import type { Playbook } from '@/lib/goalTypes';
import type { WorkspaceData } from './GoalsWorkspace';
import { Sheet } from './Sheet';
import styles from './Goals.module.css';

type Editing = { id: string | null; name: string; instructions: string };

/** Playbooks: the user's own instructions for how answers should sound. */
export function PlaybooksTab({ data, reload }: { data: WorkspaceData; reload: () => Promise<void> }) {
  const t = useTranslations('Goals');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ids = { name: useId(), instructions: useId(), limit: useId(), list: useId() };
  const close = useCallback(() => {
    setEditing(null);
    setFailed(false);
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setFailed(false);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return setBusy(false);
    const row = { user_id: user.id, name: editing.name.trim(), instructions: editing.instructions.trim(), updated_at: new Date().toISOString() };
    const { error } = editing.id
      ? await supabase.from('playbooks').update(row).eq('id', editing.id)
      : await supabase.from('playbooks').insert(row);
    setBusy(false);
    if (error) return setFailed(true);
    setEditing(null);
    await reload();
  }

  async function remove(playbook: Playbook) {
    if (!window.confirm(t('confirmDeletePlaybook', { name: playbook.name }))) return;
    await createClient().from('playbooks').delete().eq('id', playbook.id);
    await reload();
  }

  return (
    <div className={styles.tabBody}>
      <div className={styles.toolbar}>
        <p className={styles.intro}>{t('playbooksHelp')}</p>
        <div className={styles.toolbarActions}>
          <button type="button" className="button" onClick={() => setEditing({ id: null, name: t('examplePlaybookName'), instructions: t('examplePlaybook') })}>
            {t('startFromExample')}
          </button>
          <button type="button" className="button buttonPrimary" onClick={() => setEditing({ id: null, name: '', instructions: '' })}>
            {t('newPlaybook')}
          </button>
        </div>
      </div>

      <section className={styles.listPane} aria-labelledby={ids.list}>
        <h2 className={styles.paneTitle} id={ids.list}>
          {t('yourPlaybooks')}
          <span className={styles.paneCount}>{data.playbooks.length}</span>
        </h2>
        {data.playbooks.length === 0 ? (
          <p className={`emptyState ${styles.empty}`}>{t('noPlaybooks')}</p>
        ) : (
          <ul className={styles.rows}>
            {data.playbooks.map((playbook) => (
              <li key={playbook.id} className={styles.row}>
                <div className={styles.rowBody}>
                  <span className={styles.rowTitle}>{playbook.name}</span>
                  <p className={styles.clamp}>{playbook.instructions}</p>
                </div>
                <div className={styles.rowActions}>
                  <button
                    type="button"
                    className="button buttonGhost buttonSmall"
                    onClick={() => setEditing({ id: playbook.id, name: playbook.name, instructions: playbook.instructions })}
                  >
                    {t('edit')}
                  </button>
                  <button type="button" className="button buttonGhost buttonSmall" onClick={() => void remove(playbook)}>
                    {t('delete')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing ? (
        <Sheet
          title={editing.id ? t('editPlaybook') : t('newPlaybook')}
          onClose={close}
          onSubmit={save}
          footer={
            <>
              {failed ? (
                <p className={styles.sheetError} role="alert">
                  {t('saveFailed')}
                </p>
              ) : null}
              <button type="button" className="button" onClick={close}>
                {t('cancel')}
              </button>
              <button type="submit" className="button buttonPrimary" disabled={busy || !editing.name.trim() || !editing.instructions.trim()}>
                {busy ? t('saving') : t('save')}
              </button>
            </>
          }
        >
          <label className="label" htmlFor={ids.name}>
            {t('playbookName')}
            <input
              id={ids.name}
              className="input"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              maxLength={120}
              required
            />
          </label>
          <label className="label" htmlFor={ids.instructions}>
            {t('playbookInstructions')}
            <textarea
              id={ids.instructions}
              className={`textarea ${styles.instructions}`}
              rows={12}
              value={editing.instructions}
              onChange={(e) => setEditing({ ...editing, instructions: e.target.value })}
              maxLength={4000}
              required
              aria-describedby={ids.limit}
            />
            <span id={ids.limit} className="help">
              {t('playbookLimit')}
            </span>
          </label>
        </Sheet>
      ) : null}
    </div>
  );
}
