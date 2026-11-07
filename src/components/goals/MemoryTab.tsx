'use client';

import { useId, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/browser';
import type { Memory } from '@/lib/goalTypes';
import type { WorkspaceData } from './GoalsWorkspace';
import styles from './Goals.module.css';

/** Long-term memory: facts about you the copilot keeps between sessions. */
export function MemoryTab({ data, reload }: { data: WorkspaceData; reload: () => Promise<void> }) {
  const t = useTranslations('Goals');
  const format = useFormatter();
  const [content, setContent] = useState('');
  const [goalId, setGoalId] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [enabled, setEnabled] = useState(data.memoryEnabled);
  const ids = { content: useId(), goal: useId() };

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailed(false);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return setBusy(false);
    const { error } = await supabase
      .from('memories')
      .insert({ user_id: user.id, content: content.trim().slice(0, 600), goal_id: goalId || null, source: 'manual' });
    setBusy(false);
    if (error) return setFailed(true);
    setContent('');
    await reload();
  }

  async function remove(memory: Memory) {
    await createClient().from('memories').delete().eq('id', memory.id);
    await reload();
  }

  async function toggleLearning(next: boolean) {
    setEnabled(next);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) await supabase.from('profiles').update({ memory_enabled: next }).eq('id', user.id);
  }

  async function forgetAll() {
    if (!window.confirm(t('confirmForgetAll'))) return;
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) await supabase.from('memories').delete().eq('user_id', user.id);
    await reload();
  }

  const goalName = (id: string | null) => (id ? data.goals.find((goal) => goal.id === id)?.name ?? null : null);

  return (
    <div className={styles.split}>
      <section className="card">
        <div className="cardInner stack">
          <div>
            <h2 className="cardTitle">{t('memoryTitle')}</h2>
            <p className="help">{t('memoryHelp')}</p>
          </div>
          <label className="checkbox-label" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={enabled} onChange={(e) => void toggleLearning(e.target.checked)} />
            <span>
              {t('learnFromSessions')}
              <span className="help" style={{ display: 'block' }}>
                {t('learnFromSessionsHelp')}
              </span>
            </span>
          </label>
          <form className="stack" onSubmit={add}>
            <label className="label" htmlFor={ids.content}>
              {t('addMemory')}
              <textarea
                id={ids.content}
                className="textarea"
                rows={3}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                maxLength={600}
                placeholder={t('memoryPlaceholder')}
                required
              />
            </label>
            <label className="label" htmlFor={ids.goal}>
              {t('memoryGoal')}
              <select id={ids.goal} className="select" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                <option value="">{t('allGoals')}</option>
                {data.goals.map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.name}
                  </option>
                ))}
              </select>
            </label>
            {failed ? (
              <p className="help" role="alert" style={{ margin: 0 }}>
                {t('saveFailed')}
              </p>
            ) : null}
            <button type="submit" className="button buttonPrimary" disabled={busy || !content.trim()}>
              {busy ? t('saving') : t('remember')}
            </button>
          </form>
        </div>
      </section>

      <section className="card">
        <div className="cardInner stack">
          <div className={styles.toolbar}>
            <h2 className="cardTitle">{t('whatIKnow')}</h2>
            {data.memories.length ? (
              <button type="button" className="button buttonGhost" onClick={() => void forgetAll()}>
                {t('forgetAll')}
              </button>
            ) : null}
          </div>
          {data.memories.length === 0 ? (
            <p className="help">{t('noMemories')}</p>
          ) : (
            <ul className={styles.list}>
              {data.memories.map((memory) => (
                <li key={memory.id} className={styles.listItem}>
                  <div>
                    <p className={styles.memory}>{memory.content}</p>
                    <span className={styles.meta}>
                      {memory.source === 'session' ? t('learnedInSession') : t('addedByYou')} ·{' '}
                      {goalName(memory.goal_id) ?? t('allGoals')} · {format.dateTime(new Date(memory.created_at), { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                  <button type="button" className="button buttonGhost" onClick={() => void remove(memory)}>
                    {t('forget')}
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
