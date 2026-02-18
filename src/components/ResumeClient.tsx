'use client';

import { useMemo, useState } from 'react';

type Doc = {
  id: string;
  filename: string | null;
  created_at: string;
  parsed_text?: string | null;
  ats_score?: number | null;
  keywords?: string[];
  version?: number;
  parse_status?: string;
};
type Gen = {
  id: string;
  status: string;
  created_at: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  document_id: string | null;
};

type ATSResult = {
  atsScore: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  suggestions: string[];
  formatIssues: string[];
};

type BulletAnalysis = {
  original: string;
  score: number;
  issues: string[];
  rewritten?: string;
  suggestions: string[];
};

export function ResumeClient(props: { initialDocs: Doc[]; initialGenerations: Gen[] }) {
  const [docs, setDocs] = useState<Doc[]>(props.initialDocs ?? []);
  const [gens, setGens] = useState<Gen[]>(props.initialGenerations ?? []);

  const [file, setFile] = useState<File | null>(null);
  const [jobDescription, setJobDescription] = useState('');
  const [selectedDocId, setSelectedDocId] = useState<string>('');

  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Analysis state
  const [atsResult, setAtsResult] = useState<ATSResult | null>(null);
  const [bulletAnalyses, setBulletAnalyses] = useState<BulletAnalysis[]>([]);
  const [bulletInput, setBulletInput] = useState<string>('');

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

      const res = await fetch('/api/resume/upload?autoParse=true', { method: 'POST', body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? 'Upload failed');

      setDocs((d) => [json.document, ...d]);
      setSelectedDocId(json.document.id);
      setFile(null);
      setOk(`Uploaded. Parsing ${json.parsed?.status === 'completed' ? 'completed' : 'in progress'}.`);
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

  async function runATSAnalysis() {
    if (!selectedDocId || !jobDescription) {
      setError('Please select a document and provide a job description');
      return;
    }
    setError(null);
    setAnalyzing(true);

    try {
      const res = await fetch(`/api/resume/${selectedDocId}/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobDescription }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? 'Analysis failed');

      setAtsResult(json);
      setOk(`ATS Score: ${json.atsScore}%`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  }

  async function optimizeKeywords() {
    if (!selectedDocId || !jobDescription) {
      setError('Please select a document and provide a job description');
      return;
    }
    setError(null);
    setAnalyzing(true);

    try {
      const res = await fetch(`/api/resume/${selectedDocId}/keywords`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobDescription }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? 'Keyword optimization failed');

      setOk(`Found ${json.suggestedKeywords?.length || 0} keywords to add`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Keyword optimization failed');
    } finally {
      setAnalyzing(false);
    }
  }

  async function analyzeBullets() {
    if (!selectedDocId || !bulletInput.trim()) {
      setError('Please enter bullet points to analyze');
      return;
    }
    setError(null);
    setAnalyzing(true);

    try {
      const bullets = bulletInput.split('\n').filter((b) => b.trim());
      const res = await fetch(`/api/resume/${selectedDocId}/bullets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bullets, rewrite: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? 'Bullet analysis failed');

      setBulletAnalyses(json.analyses || []);
      setOk('Bullet points analyzed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bullet analysis failed');
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <section className="card" aria-label="Upload and analyze">
        <div className="cardInner stack">
          <h2 className="cardTitle">Resume Builder</h2>
          <p className="cardDesc">Upload your resume and optimize it for specific job applications.</p>

          <div className="stack">
            {/* Upload Section */}
            <label className="label">
              Upload CV (PDF/DOCX)
              <input
                className="input"
                type="file"
                accept=".pdf,.docx,.doc"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                aria-label="CV file"
              />
            </label>

            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="button buttonPrimary" type="button" onClick={upload} disabled={!file || uploading}>
                {uploading ? 'Uploading…' : 'Upload & Parse'}
              </button>
            </div>

            <hr className="hr" />

            {/* Document Selection */}
            <label className="label">
              Select document
              <select
                className="select"
                value={selectedDocId}
                onChange={(e) => {
                  setSelectedDocId(e.target.value);
                  setAtsResult(null);
                }}
              >
                <option value="">— Select a document —</option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.filename ?? d.id} {d.ats_score ? `(${d.ats_score}%)` : ''} v{d.version || 1}
                  </option>
                ))}
              </select>
            </label>

            {/* Job Description */}
            <label className="label">
              Job Description
              <textarea
                className="textarea"
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                placeholder="Paste the job description…"
                rows={5}
              />
            </label>

            {/* Action Buttons */}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button
                className="button buttonPrimary"
                type="button"
                onClick={runATSAnalysis}
                disabled={!selectedDocId || !jobDescription || analyzing}
              >
                {analyzing ? 'Analyzing…' : 'Run ATS Analysis'}
              </button>
              <button
                className="button"
                type="button"
                onClick={optimizeKeywords}
                disabled={!selectedDocId || !jobDescription || analyzing}
              >
                Optimize Keywords
              </button>
              <button
                className="button"
                type="button"
                onClick={generate}
                disabled={!selectedDocId || generating}
              >
                {generating ? 'Requesting…' : 'Generate'}
              </button>
            </div>

            {/* ATS Results */}
            {atsResult && (
              <div className="resultBox">
                <h4>ATS Analysis Results</h4>
                <div className="scoreDisplay">
                  <span className="scoreLabel">Score:</span>
                  <span className={`scoreValue ${atsResult.atsScore >= 70 ? 'good' : atsResult.atsScore >= 50 ? 'medium' : 'low'}`}>
                    {atsResult.atsScore}%
                  </span>
                </div>
                {atsResult.matchedKeywords.length > 0 && (
                  <div className="keywordSection">
                    <strong>Matched Keywords:</strong>
                    <div className="keywordTags">
                      {atsResult.matchedKeywords.map((k) => (
                        <span key={k} className="keywordTag matched">{k}</span>
                      ))}
                    </div>
                  </div>
                )}
                {atsResult.missingKeywords.length > 0 && (
                  <div className="keywordSection">
                    <strong>Missing Keywords:</strong>
                    <div className="keywordTags">
                      {atsResult.missingKeywords.slice(0, 10).map((k) => (
                        <span key={k} className="keywordTag missing">{k}</span>
                      ))}
                    </div>
                  </div>
                )}
                {atsResult.suggestions.length > 0 && (
                  <div className="suggestions">
                    <strong>Suggestions:</strong>
                    <ul>
                      {atsResult.suggestions.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Bullet Analysis Section */}
            <hr className="hr" />
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Bullet Point Rewriter</h3>
            <label className="label">
              Enter bullet points (one per line)
              <textarea
                className="textarea"
                value={bulletInput}
                onChange={(e) => setBulletInput(e.target.value)}
                placeholder="Led a team of 5 engineers&#10;Improved system performance&#10;Worked on customer issues"
                rows={4}
              />
            </label>
            <button
              className="button"
              type="button"
              onClick={analyzeBullets}
              disabled={!selectedDocId || !bulletInput.trim() || analyzing}
            >
              {analyzing ? 'Analyzing…' : 'Rewrite Bullets'}
            </button>

            {bulletAnalyses.length > 0 && (
              <div className="bulletResults">
                {bulletAnalyses.map((analysis, i) => (
                  <div key={i} className="bulletAnalysis">
                    <div className="bulletOriginal">
                      <strong>Original:</strong> {analysis.original}
                    </div>
                    {analysis.rewritten && (
                      <div className="bulletRewritten">
                        <strong>Rewritten:</strong> {analysis.rewritten}
                      </div>
                    )}
                    <div className={`bulletScore ${analysis.score >= 70 ? 'good' : analysis.score >= 50 ? 'medium' : 'low'}`}>
                      Score: {analysis.score}/100
                    </div>
                    {analysis.issues.length > 0 && (
                      <div className="bulletIssues">
                        Issues: {analysis.issues.join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

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
                    {d.ats_score ? ` (${d.ats_score}%)` : ''}
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

      <style jsx>{`
        .resultBox {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          padding: 16px;
          margin-top: 16px;
        }
        .resultBox h4 {
          margin: 0 0 12px;
          font-size: 1rem;
        }
        .scoreDisplay {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
        }
        .scoreLabel {
          font-weight: bold;
        }
        .scoreValue {
          font-size: 1.5rem;
          font-weight: bold;
        }
        .scoreValue.good { color: #22c55e; }
        .scoreValue.medium { color: #f59e0b; }
        .scoreValue.low { color: #ef4444; }
        .keywordSection {
          margin-bottom: 12px;
        }
        .keywordTags {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 4px;
        }
        .keywordTag {
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.75rem;
        }
        .keywordTag.matched {
          background: rgba(34, 197, 94, 0.2);
          color: #22c55e;
        }
        .keywordTag.missing {
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
        }
        .suggestions {
          margin-top: 12px;
        }
        .suggestions ul {
          margin: 4px 0 0;
          padding-left: 20px;
        }
        .bulletResults {
          margin-top: 16px;
        }
        .bulletAnalysis {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          padding: 12px;
          margin-bottom: 8px;
        }
        .bulletOriginal {
          color: var(--muted);
          margin-bottom: 8px;
        }
        .bulletRewritten {
          color: #22c55e;
          margin-bottom: 8px;
        }
        .bulletScore {
          font-weight: bold;
        }
        .bulletScore.good { color: #22c55e; }
        .bulletScore.medium { color: #f59e0b; }
        .bulletScore.low { color: #ef4444; }
        .bulletIssues {
          color: var(--muted);
          font-size: 0.875rem;
          margin-top: 4px;
        }
      `}</style>
    </div>
  );
}
