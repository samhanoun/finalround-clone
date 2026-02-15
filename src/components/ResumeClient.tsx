'use client';

import { useMemo, useState } from 'react';

type Doc = { id: string; filename: string | null; created_at: string };
type Gen = {
  id: string;
  status: string;
  created_at: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  document_id: string | null;
};

export function ResumeClient(props: { initialDocs: Doc[]; initialGenerations: Gen[] }) {
  const [docs, setDocs] = useState<Doc[]>(props.initialDocs ?? []);
  const [gens, setGens] = useState<Gen[]>(props.initialGenerations ?? []);

  const [file, setFile] = useState<File | null>(null);
  const [jobDescription, setJobDescription] = useState('');
  const [selectedDocId, setSelectedDocId] = useState<string>('');

  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const historyUrl = useMemo(() => '/api/resume/history', []);

  async function refreshHistory() {
    const res = await fetch(historyUrl);
    const json = await res.json().catch(() => ({}));
    if (res.ok) setGens(json.generations ?? []);
  }

  async function upload() {
    if (!file) return;
    setError(null);
    setOk(null);
    setUploading(true);

    try {
      const form = new FormData();
      form.set('file', file);

      const res = await fetch('/api/resume/upload', { method: 'POST', body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? 'Upload failed');

      setDocs((d) => [json.document, ...d]);
      setSelectedDocId(json.document.id);
      setFile(null);
      setOk('Uploaded. You can now request a generation.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function generate() {
    setError(null);
    setOk(null);
    setGenerating(true);

    try {
      const payload = {
        documentId: selectedDocId || undefined,
        input: {
          jobDescription,
        },
      };

      const res = await fetch('/api/resume/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? 'Generate failed');

      setOk('Generation requested (queued).');
      await refreshHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generate failed');
    } finally {
      setGenerating(false);
    }
  }

  async function download(docId: string) {
    setError(null);
    setOk(null);

    try {
      const res = await fetch(`/api/resume/${docId}/download`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? 'Download failed');

      const url = String(json.url || '');
      if (!url) throw new Error('Missing signed URL');

      // Trigger download in a new tab.
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    }
  }

  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <section className="card" aria-label="Upload and generate">
        <div className="cardInner stack">
          <h2 className="cardTitle">Upload CV + request variants</h2>
          <p className="cardDesc">Upload a PDF/DOCX, paste the job description, and create a generation record.</p>

          <div className="stack">
            <label className="label">
              CV file
              <input
                className="input"
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                aria-label="CV file"
              />
            </label>

            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="button buttonPrimary" type="button" onClick={upload} disabled={!file || uploading}>
                {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>

            <label className="label">
              Select document (optional)
              <select className="select" value={selectedDocId} onChange={(e) => setSelectedDocId(e.target.value)}>
                <option value="">— None —</option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.filename ?? d.id}
                  </option>
                ))}
              </select>
            </label>

            <label className="label">
              Job description
              <textarea
                className="textarea"
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                placeholder="Paste the job description…"
              />
            </label>

            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="button buttonPrimary" type="button" onClick={generate} disabled={generating}>
                {generating ? 'Requesting…' : 'Generate'}
              </button>
            </div>

            {error ? <div className="error">{error}</div> : null}
            {ok ? <div className="success">{ok}</div> : null}
          </div>
        </div>
      </section>

      <aside className="card" aria-label="History">
        <div className="cardInner stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 className="cardTitle">History</h2>
            <button className="button" type="button" onClick={refreshHistory}>
              Refresh
            </button>
          </div>

          <h3 style={{ margin: 0, fontSize: '1rem' }}>Documents</h3>
          <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {docs.length ? (
              docs.map((d) => (
                <li key={d.id} className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.filename ?? d.id}
                  </span>
                  <span className="row" style={{ gap: 8 }}>
                    <button className="button" type="button" onClick={() => void download(d.id)}>
                      Download
                    </button>
                    <span className="small mono">{new Date(d.created_at).toLocaleString()}</span>
                  </span>
                </li>
              ))
            ) : (
              <li className="small">No uploads yet.</li>
            )}
          </ul>

          <hr className="hr" />

          <h3 style={{ margin: 0, fontSize: '1rem' }}>Generations</h3>
          <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {gens.length ? (
              gens.map((g) => (
                <li key={g.id} className="card" style={{ background: 'rgba(255,255,255,0.04)', boxShadow: 'none' }}>
                  <div className="cardInner stack" style={{ gap: 8 }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="badge">{g.status}</span>
                      <span className="small mono">{new Date(g.created_at).toLocaleString()}</span>
                    </div>
                    <div className="small">Doc: <span className="mono">{g.document_id ?? '—'}</span></div>
                    {g.input ? (
                      <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--muted)' }}>
                        {JSON.stringify(g.input, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                </li>
              ))
            ) : (
              <li className="small">No generations yet.</li>
            )}
          </ul>
        </div>
      </aside>
    </div>
  );
}
