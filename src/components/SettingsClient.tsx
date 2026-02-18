'use client';

import { useState, useId } from 'react';

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

  const providerId = useId();
  const modelId = useId();
  const temperatureId = useId();
  const maxTokensId = useId();

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
      setOk('Settings saved successfully.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" role="form" aria-label="LLM preferences settings">
      <div className="cardInner stack">
        <h2 className="cardTitle" id="settings-title">LLM preferences</h2>
        <p className="cardDesc">Stored per-user in <span className="mono">llm_settings</span>.</p>

        <div className="grid2">
          <label className="label" htmlFor={providerId}>
            Provider
            <select 
              className="select" 
              id={providerId}
              value={provider} 
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="google">Google</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </label>

          <label className="label" htmlFor={modelId}>
            Model
            <input 
              className="input" 
              id={modelId}
              value={model} 
              onChange={(e) => setModel(e.target.value)} 
            />
          </label>

          <label className="label" htmlFor={temperatureId}>
            Temperature
            <input 
              className="input" 
              id={temperatureId}
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={temperature} 
              onChange={(e) => setTemperature(e.target.value)} 
            />
          </label>

          <label className="label" htmlFor={maxTokensId}>
            Max tokens
            <input 
              className="input" 
              id={maxTokensId}
              type="number"
              min="1"
              max="32000"
              value={maxTokens} 
              onChange={(e) => setMaxTokens(e.target.value)} 
            />
          </label>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button 
            className="button buttonPrimary" 
            onClick={save} 
            disabled={saving} 
            type="button"
            aria-describedby={saving ? 'saving-status' : undefined}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saving && (
            <span id="saving-status" className="srOnly">
              Saving your settings, please wait...
            </span>
          )}
        </div>

        {error && (
          <div 
            className="error" 
            role="alert"
            aria-live="assertive"
          >
            {error}
          </div>
        )}
        {ok && (
          <div 
            className="success" 
            role="status"
            aria-live="polite"
          >
            {ok}
          </div>
        )}
      </div>
    </div>
  );
}
