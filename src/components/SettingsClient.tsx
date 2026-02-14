'use client';

import { useState } from 'react';

type Settings = {
  provider: string | null;
  model: string | null;
  temperature: number | null;
  max_tokens: number | null;
};

export function SettingsClient(props: { initial: Settings | null }) {
  const [provider, setProvider] = useState(props.initial?.provider ?? 'openai');
  const [model, setModel] = useState(props.initial?.model ?? 'gpt-4o-mini');
  const [temperature, setTemperature] = useState(String(props.initial?.temperature ?? 0.2));
  const [maxTokens, setMaxTokens] = useState(String(props.initial?.max_tokens ?? 1024));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function save() {
    setError(null);
    setOk(null);
    setSaving(true);

    try {
      const payload = {
        provider,
        model,
        temperature: Number(temperature),
        max_tokens: Number(maxTokens),
      };

      const res = await fetch('/api/settings/llm', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? 'Failed to save');
      setOk('Saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="cardInner stack">
        <h2 className="cardTitle">LLM preferences</h2>
        <p className="cardDesc">Stored per-user in <span className="mono">llm_settings</span>.</p>

        <div className="grid2">
          <label className="label">
            Provider
            <select className="select" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="google">Google</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </label>

          <label className="label">
            Model
            <input className="input" value={model} onChange={(e) => setModel(e.target.value)} />
          </label>

          <label className="label">
            Temperature
            <input className="input" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
          </label>

          <label className="label">
            Max tokens
            <input className="input" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
          </label>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="button buttonPrimary" onClick={save} disabled={saving} type="button">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        {error ? <div className="error">{error}</div> : null}
        {ok ? <div className="success">{ok}</div> : null}
      </div>
    </div>
  );
}
