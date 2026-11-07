'use client';

import { useCallback, useEffect, useState, useId } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useToastHook } from '@/components/Toast';
import { createClient } from '@/lib/supabase/browser';

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
type TailoredOutput = {
  target?: string;
  resume?: string;
  summary?: string;
  changes?: string[];
  keywords?: string[];
  error?: string;
};

type Gen = {
  id: string;
  status: string;
  created_at: string;
  input: Record<string, unknown>;
  output: TailoredOutput;
  document_id: string | null;
};

type KeywordResult = { suggestedKeywords: string[]; recommendation: string };

const MIN_JOB_CHARS = 50;

function isPending(gen: Gen) {
  return gen.status === 'processing';
}

function fileBase(gen: Gen) {
  const name = (gen.output.target || 'tailored-resume').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return name || 'tailored-resume';
}

function downloadText(gen: Gen) {
  const blob = new Blob([gen.output.resume ?? ''], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileBase(gen)}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

async function downloadPdf(gen: Gen) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 48;
  const width = pdf.internal.pageSize.getWidth() - margin * 2;
  const bottom = pdf.internal.pageSize.getHeight() - margin;
  let y = margin;
  pdf.setFontSize(10.5);
  for (const line of (gen.output.resume ?? '').split('\n')) {
    const heading = line.trim().length > 0 && line.trim() === line.trim().toUpperCase() && /[A-Z]/.test(line);
    pdf.setFont('helvetica', heading ? 'bold' : 'normal');
    const wrapped = pdf.splitTextToSize(line || ' ', width) as string[];
    for (const piece of wrapped) {
      if (y > bottom) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(piece, margin, y);
      y += 14;
    }
    if (heading) y += 2;
  }
  pdf.save(`${fileBase(gen)}.pdf`);
}

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
  const t = useTranslations('Resume');
  const format = useFormatter();
  const toast = useToastHook();
  /** An API error code in the user's language, or `fallback`. */
  const errorText = (code: unknown, fallback: string) =>
    typeof code === 'string' && t.has(`errors.${code}`) ? t(`errors.${code}`) : fallback;
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const [docs, setDocs] = useState<Doc[]>(props.initialDocs ?? []);
  const [gens, setGens] = useState<Gen[]>(props.initialGenerations ?? []);

  const [file, setFile] = useState<File | null>(null);
  const [jobDescription, setJobDescription] = useState('');
  const [selectedDocId, setSelectedDocId] = useState<string>('');

  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  // Analysis state
  const [atsResult, setAtsResult] = useState<ATSResult | null>(null);
  const [bulletAnalyses, setBulletAnalyses] = useState<BulletAnalysis[]>([]);
  const [bulletInput, setBulletInput] = useState<string>('');
  const [keywordResult, setKeywordResult] = useState<KeywordResult | null>(null);
  const [openGen, setOpenGen] = useState<string | null>(null);

  // Generate unique IDs for form accessibility
  const fileInputId = useId();
  const docSelectId = useId();
  const jobDescId = useId();
  const bulletInputId = useId();
  const uploadBtnId = useId();
  const atsStatusId = useId();
  const bulletStatusId = useId();

  const refreshHistory = useCallback(async () => {
    const res = await fetch('/api/resume/history');
    const json = await res.json().catch(() => ({}));
    if (res.ok) setGens(json.generations ?? []);
  }, []);

  // Tailored versions are written in the background: check until they're done.
  const pending = gens.some(isPending);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => void refreshHistory(), 4000);
    return () => window.clearInterval(timer);
  }, [pending, refreshHistory]);

  async function upload() {
    if (!file) return;
    setUploading(true);

    try {
      const form = new FormData();
      form.set('file', file);

      const res = await fetch('/api/resume/upload?autoParse=true', { method: 'POST', body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(json?.error, t('uploadFailed')));

      setDocs((d) => [json.document, ...d]);
      setSelectedDocId(json.document.id);
      setFile(null);
      toast.success(t('uploaded'), json.parsed?.status === 'completed' ? t('uploadedReady') : t('uploadedReading'));
    } catch (e) {
      const message = e instanceof Error ? e.message : t('uploadFailed');
      toast.error(t('uploadFailed'), message);
    } finally {
      setUploading(false);
    }
  }

  async function generate() {
    if (!selectedDocId || jobDescription.trim().length < MIN_JOB_CHARS) return;
    setGenerating(true);

    try {
      const res = await fetch('/api/resume/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentId: selectedDocId, jobDescription }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(json?.error, t('generateFailed')));

      setGens((current) => [json.generation as Gen, ...current]);
      setOpenGen((json.generation as Gen).id);
      toast.success(t('generatingTitle'), t('generatingBody'));
    } catch (e) {
      toast.error(t('notStarted'), e instanceof Error ? e.message : t('generateFailed'));
    } finally {
      setGenerating(false);
    }
  }

  async function removeGeneration(id: string) {
    const { error } = await createClient().from('resume_generations').delete().eq('id', id);
    if (error) {
      toast.error(t('notDeleted'), t('tryAgain'));
      return;
    }
    setGens((current) => current.filter((gen) => gen.id !== id));
  }

  async function copyResume(gen: Gen) {
    try {
      await navigator.clipboard.writeText(gen.output.resume ?? '');
      toast.success(t('copied'), t('copiedBody'));
    } catch {
      toast.error(t('notCopied'), t('notCopiedBody'));
    }
  }

  async function download(docId: string, _docName: string) {
    try {
      const res = await fetch(`/api/resume/${docId}/download`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(json?.error, t('downloadFailed')));

      const url = String(json.url || '');
      if (!url) throw new Error(t('downloadFailed'));

      // Trigger download in a new tab.
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      const message = e instanceof Error ? e.message : t('downloadFailed');
      toast.error(t('downloadFailed'), message);
    }
  }

  async function runATSAnalysis() {
    if (!selectedDocId || !jobDescription) {
      toast.warning(t('pickTitle'), t('pickBody'));
      return;
    }
    setAtsResult(null);
    setAnalyzing(true);

    try {
      const res = await fetch(`/api/resume/${selectedDocId}/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobDescription }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(json?.error, t('checkFailed')));

      setAtsResult(json);
      toast.info(t('scoreTitle'), t('scoreBody', { score: json.atsScore }));
    } catch (e) {
      const message = e instanceof Error ? e.message : t('checkFailed');
      toast.error(t('checkFailed'), message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function optimizeKeywords() {
    if (!selectedDocId || !jobDescription) {
      toast.warning(t('pickTitle'), t('pickBody'));
      return;
    }
    setAnalyzing(true);

    try {
      const res = await fetch(`/api/resume/${selectedDocId}/keywords`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobDescription }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(json?.error, t('keywordsFailed')));

      setKeywordResult({ suggestedKeywords: json.suggestedKeywords ?? [], recommendation: json.recommendation ?? '' });
    } catch (e) {
      const message = e instanceof Error ? e.message : t('keywordsFailed');
      toast.error(t('keywordsFailed'), message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function analyzeBullets() {
    if (!selectedDocId || !bulletInput.trim()) {
      toast.warning(t('bulletsMissingTitle'), t('bulletsMissingBody'));
      return;
    }
    setAnalyzing(true);

    try {
      const bullets = bulletInput.split('\n').filter((b) => b.trim());
      const res = await fetch(`/api/resume/${selectedDocId}/bullets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bullets, rewrite: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(json?.error, t('bulletsFailed')));

      setBulletAnalyses(json.analyses || []);
      toast.success(t('rewrittenTitle'), t('rewrittenBody'));
    } catch (e) {
      const message = e instanceof Error ? e.message : t('bulletsFailed');
      toast.error(t('bulletsFailed'), message);
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <section className="card" aria-labelledby="resume-builder-heading">
        <div className="cardInner stack">
          <h2 className="cardTitle" id="resume-builder-heading">{t('title')}</h2>
          <p className="cardDesc">{t('desc')}</p>

          <div className="stack">
            {/* Upload Section */}
            <label className="label" htmlFor={fileInputId}>
              {t('file')}
              <input
                className="input"
                type="file"
                id={fileInputId}
                accept=".pdf,.docx,.doc"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                aria-label={t('fileLabel')}
              />
            </label>

            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button 
                className="button buttonPrimary" 
                type="button" 
                onClick={upload} 
                disabled={!file || uploading}
                id={uploadBtnId}
                aria-describedby={uploading ? 'upload-status' : undefined}
              >
                {uploading ? t('uploading') : t('upload')}
              </button>
              {uploading && (
                <span id="upload-status" className="srOnly">
                  {t('uploadingStatus')}
                </span>
              )}
            </div>

            <hr className="hr" />

            {/* Document Selection */}
            <label className="label" htmlFor={docSelectId}>
              {t('resume')}
              <select
                className="select"
                id={docSelectId}
                value={selectedDocId}
                onChange={(e) => {
                  setSelectedDocId(e.target.value);
                  setAtsResult(null);
                  setKeywordResult(null);
                }}
              >
                <option value="">{t('chooseResume')}</option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.filename ?? d.id} {d.ats_score ? `(${d.ats_score}%)` : ''} v{d.version || 1}
                  </option>
                ))}
              </select>
            </label>

            {/* Job Description */}
            <label className="label" htmlFor={jobDescId}>
              {t('job')}
              <textarea
                className="textarea"
                id={jobDescId}
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                placeholder={t('jobPlaceholder')}
                rows={5}
                aria-describedby="job-desc-help"
              />
              <span id="job-desc-help" className="help">
                {t('jobHelp')}
              </span>
            </label>

            {/* Action Buttons */}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }} role="group" aria-label={t('actions')}>
              <button
                className="button buttonPrimary"
                type="button"
                onClick={runATSAnalysis}
                disabled={!selectedDocId || !jobDescription || analyzing}
                aria-describedby={analyzing ? atsStatusId : undefined}
              >
                {analyzing ? t('checking') : t('check')}
              </button>
              <button
                className="button"
                type="button"
                onClick={optimizeKeywords}
                disabled={!selectedDocId || !jobDescription || analyzing}
              >
                {t('findKeywords')}
              </button>
              <button
                className="button"
                type="button"
                onClick={generate}
                disabled={!selectedDocId || jobDescription.trim().length < MIN_JOB_CHARS || generating}
              >
                {generating ? t('starting') : t('generate')}
              </button>
            </div>

            {/* Status for ATS analysis */}
            {analyzing && (
              <span id={atsStatusId} className="srOnly">
                {t('checkingStatus')}
              </span>
            )}

            {/* ATS Results */}
            {atsResult && (
              <div className="resultBox" role="region" aria-labelledby="ats-results-heading">
                <h4 id="ats-results-heading">{t('matchTitle')}</h4>
                <div className="scoreDisplay">
                  <span className="scoreLabel">{t('score')}</span>
                  <span 
                    className={`scoreValue ${atsResult.atsScore >= 70 ? 'good' : atsResult.atsScore >= 50 ? 'medium' : 'low'}`}
                    aria-label={t('scoreLabel', { score: atsResult.atsScore })}
                  >
                    {atsResult.atsScore}%
                  </span>
                </div>
                {atsResult.matchedKeywords.length > 0 && (
                  <div className="keywordSection">
                    <strong>{t('matched')}</strong>
                    <div className="keywordTags" role="list" aria-label={t('matchedLabel')}>
                      {atsResult.matchedKeywords.map((k) => (
                        <span key={k} className="keywordTag matched" role="listitem">{k}</span>
                      ))}
                    </div>
                  </div>
                )}
                {atsResult.missingKeywords.length > 0 && (
                  <div className="keywordSection">
                    <strong>{t('missing')}</strong>
                    <div className="keywordTags" role="list" aria-label={t('missingLabel')}>
                      {atsResult.missingKeywords.slice(0, 10).map((k) => (
                        <span key={k} className="keywordTag missing" role="listitem">{k}</span>
                      ))}
                    </div>
                  </div>
                )}
                {atsResult.suggestions.length > 0 && (
                  <div className="suggestions">
                    <strong>{t('suggestions')}</strong>
                    <ul role="list">
                      {atsResult.suggestions.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {keywordResult && (
              <div className="resultBox" role="region" aria-labelledby="keyword-results-heading">
                <h4 id="keyword-results-heading">{t('keywordsTitle')}</h4>
                {keywordResult.suggestedKeywords.length ? (
                  <div className="keywordTags" role="list" aria-label={t('missingLabel')}>
                    {keywordResult.suggestedKeywords.map((k) => (
                      <span key={k} className="keywordTag missing" role="listitem">{k}</span>
                    ))}
                  </div>
                ) : (
                  <p className="small" style={{ margin: 0 }}>{t('keywordsNone')}</p>
                )}
                <p className="help" style={{ marginBottom: 0 }}>{t('keywordsHelp')}</p>
              </div>
            )}

            {/* Bullet Analysis Section */}
            <hr className="hr" />
            <h3 style={{ margin: 0, fontSize: '1rem' }} id="bullet-rewriter-heading">{t('bulletsTitle')}</h3>
            <label className="label" htmlFor={bulletInputId}>
              {t('bulletsInput')}
              <textarea
                className="textarea"
                id={bulletInputId}
                value={bulletInput}
                onChange={(e) => setBulletInput(e.target.value)}
                placeholder={t('bulletsPlaceholder')}
                rows={4}
                aria-describedby={analyzing ? bulletStatusId : undefined}
              />
            </label>
            {analyzing && (
              <span id={bulletStatusId} className="srOnly">
                {t('bulletsStatus')}
              </span>
            )}
            <button
              className="button"
              type="button"
              onClick={analyzeBullets}
              disabled={!selectedDocId || !bulletInput.trim() || analyzing}
            >
              {analyzing ? t('rewriting') : t('rewrite')}
            </button>

            {bulletAnalyses.length > 0 && (
              <div className="bulletResults" role="region" aria-labelledby="bullet-results-heading">
                <h4 id="bullet-results-heading" className="srOnly">{t('rewrittenHeading')}</h4>
                {bulletAnalyses.map((analysis, i) => (
                  <div key={i} className="bulletAnalysis" role="article" aria-label={t('analysisLabel', { n: i + 1, total: bulletAnalyses.length })}>
                    <div className="bulletOriginal">
                      <strong>{t('original')}</strong> {analysis.original}
                    </div>
                    {analysis.rewritten && (
                      <div className="bulletRewritten">
                        <strong>{t('rewritten')}</strong> {analysis.rewritten}
                      </div>
                    )}
                    <div 
                      className={`bulletScore ${analysis.score >= 70 ? 'good' : analysis.score >= 50 ? 'medium' : 'low'}`}
                      aria-label={t('bulletScoreLabel', { score: analysis.score })}
                    >
                      {t('bulletScore', { score: analysis.score })}
                    </div>
                    {analysis.issues.length > 0 && (
                      <div className="bulletIssues">
                        {t('issues', { issues: analysis.issues.join(', ') })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <aside className="card" aria-labelledby="history-heading">
        <div className="cardInner stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 className="cardTitle" id="history-heading">{t('history')}</h2>
            <button 
              className="button" 
              type="button" 
              onClick={refreshHistory}
              aria-label={t('refreshLabel')}
            >
              {t('refresh')}
            </button>
          </div>

          <h3 style={{ margin: 0, fontSize: '1rem' }} id="documents-heading">{t('documents')}</h3>
          <ul 
            className="stack" 
            style={{ listStyle: 'none', padding: 0, margin: 0 }} 
            role="list" 
            aria-label={t('documentsLabel')}
          >
            {docs.length ? (
              docs.map((d) => (
                <li key={d.id} className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                  <span 
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    aria-label={
                      d.ats_score
                        ? t('documentScoreLabel', { name: d.filename ?? d.id, score: d.ats_score })
                        : t('documentLabel', { name: d.filename ?? d.id })
                    }
                  >
                    {d.filename ?? d.id}
                    {d.ats_score ? ` (${d.ats_score}%)` : ''}
                  </span>
                  <span className="row" style={{ gap: 8 }}>
                    <button 
                      className="button" 
                      type="button" 
                      onClick={() => void download(d.id, d.filename ?? '')}
                      aria-label={t('downloadLabel', { name: d.filename ?? t('document') })}
                    >
                      {t('download')}
                    </button>
                    <span className="small mono">{when(d.created_at)}</span>
                  </span>
                </li>
              ))
            ) : (
              <li className="small" aria-live="polite">{t('noUploads')}</li>
            )}
          </ul>

          <hr className="hr" />

          <h3 style={{ margin: 0, fontSize: '1rem' }} id="generations-heading">{t('tailored')}</h3>
          <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }} role="list" aria-labelledby="generations-heading">
            {gens.length ? (
              gens.map((g) => {
                const done = g.status === 'completed' && Boolean(g.output?.resume);
                const open = openGen === g.id;
                return (
                  <li key={g.id} className="card" style={{ background: 'rgba(255,255,255,0.04)', boxShadow: 'none' }}>
                    <div className="cardInner stack" style={{ gap: 8 }}>
                      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                        <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {g.output?.target || t('tailoredFallback')}
                        </strong>
                        <span className="badge" role="status">
                          {isPending(g) ? t('statusWriting') : done ? t('statusReady') : t('statusFailed')}
                        </span>
                      </div>
                      <span className="small mono">{when(g.created_at)}</span>
                      {isPending(g) && <p className="small" style={{ margin: 0 }}>{t('writingNow')}</p>}
                      {!isPending(g) && !done && (
                        <p className="small" style={{ margin: 0 }}>{t('writeFailed')}</p>
                      )}
                      {done && g.output.summary && <p className="small" style={{ margin: 0 }}>{g.output.summary}</p>}
                      {done && open && (
                        <>
                          {g.output.changes?.length ? (
                            <div className="suggestions">
                              <strong>{t('changed')}</strong>
                              <ul>
                                {g.output.changes.map((change, i) => (
                                  <li key={i}>{change}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          {g.output.keywords?.length ? (
                            <div className="keywordTags" role="list" aria-label={t('coveredLabel')}>
                              {g.output.keywords.map((k) => (
                                <span key={k} className="keywordTag matched" role="listitem">{k}</span>
                              ))}
                            </div>
                          ) : null}
                          <pre className="tailored">{g.output.resume}</pre>
                        </>
                      )}
                      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                        {done && (
                          <>
                            <button className="button" type="button" onClick={() => setOpenGen(open ? null : g.id)} aria-expanded={open}>
                              {open ? t('hide') : t('show')}
                            </button>
                            <button className="button" type="button" onClick={() => void copyResume(g)}>{t('copy')}</button>
                            <button className="button" type="button" onClick={() => void downloadPdf(g)}>{t('pdf')}</button>
                            <button className="button" type="button" onClick={() => downloadText(g)}>{t('text')}</button>
                          </>
                        )}
                        {!isPending(g) && (
                          <button className="button buttonGhost" type="button" onClick={() => void removeGeneration(g.id)}>
                            {t('delete')}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })
            ) : (
              <li className="small">{t('noTailored')}</li>
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
        .tailored {
          margin: 0;
          white-space: pre-wrap;
          font-family: inherit;
          font-size: 0.875rem;
          line-height: 1.5;
          max-height: 420px;
          overflow: auto;
          padding: 12px;
          border-radius: 8px;
          background: rgba(0, 0, 0, 0.25);
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
