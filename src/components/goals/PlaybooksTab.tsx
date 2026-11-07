'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/browser';
import type { Playbook } from '@/lib/goalTypes';
import type { WorkspaceData } from './GoalsWorkspace';
import styles from './Goals.module.css';

/** Playbooks: the user's own instructions for how answers should sound. */
export function PlaybooksTab({ data, reload }: { data: WorkspaceData; reload: () => Promise<void> }) {
  const t = useTranslations('Goals');
  const [editing, setEditing] = useState<{ id: string | null; name: string; instructions: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const ids = { name: useId(), instructions: useId() };

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
    <div className={styles.split}>
      <section className="card">
        <div className="cardInner stack">
          <div>
            <h2 className="cardTitle">{t('playbooksTitle')}</h2>
            <p className="help">{t('playbooksHelp')}</p>
          </div>
          {editing ? (
            <form className="stack" onSubmit={save}>
              <label className="label" htmlFor={ids.name}>
                {t('playbookName')}
                <input id={ids.name} className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={120} required />
              </label>
              <label className="label" htmlFor={ids.instructions}>
                {t('playbookInstructions')}
                <textarea
                  id={ids.instructions}
                  className="textarea"
                  rows={9}
                  value={editing.instructions}
                  onChange={(e) => setEditing({ ...editing, instructions: e.target.value })}
                  maxLength={4000}
                  required
                />
                <span className="help">{t('playbookLimit')}</span>
              </label>
              {failed ? (
                <p className="help" role="alert" style={{ margin: 0 }}>
                  {t('saveFailed')}
                </p>
              ) : null}
              <div className={styles.cardActions}>
                <button type="button" className="button" onClick={() => setEditing(null)}>
                  {t('cancel')}
                </button>
                <button type="submit" className="button buttonPrimary" disabled={busy || !editing.name.trim() || !editing.instructions.trim()}>
                  {busy ? t('saving') : t('save')}
                </button>
              </div>
            </form>
          ) : (
            <div className={styles.cardActions}>
              <button type="button" className="button buttonPrimary" onClick={() => setEditing({ id: null, name: '', instructions: '' })}>
                {t('newPlaybook')}
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setEditing({ id: null, name: t('examplePlaybookName'), instructions: t('examplePlaybook') })}
              >
                {t('startFromExample')}
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="cardInner stack">
          <h2 className="cardTitle">{t('yourPlaybooks')}</h2>
          {data.playbooks.length === 0 ? (
            <p className="help">{t('noPlaybooks')}</p>
          ) : (
            <ul className={styles.list}>
              {data.playbooks.map((playbook) => (
                <li key={playbook.id} className={styles.listItem}>
                  <div>
                    <strong>{playbook.name}</strong>
                    <p className={styles.preview}>{playbook.instructions}</p>
                  </div>
                  <div className={styles.cardActions}>
                    <button type="button" className="button buttonGhost" onClick={() => setEditing({ id: playbook.id, name: playbook.name, instructions: playbook.instructions })}>
                      {t('edit')}
                    </button>
                    <button type="button" className="button buttonGhost" onClick={() => void remove(playbook)}>
                      {t('delete')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
