'use client';

import { useCallback, useEffect, useState, useId } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useToastHook } from '@/components/Toast';
import { ResumeIcon } from '@/components/icons';
import { createClient } from '@/lib/supabase/browser';
import styles from './ResumeClient.module.css';

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
  // A new file input after each upload, so the chosen file's name clears.
  const [fileKey, setFileKey] = useState(0);

  // Unique IDs for form accessibility
  const fileInputId = useId();
  const docSelectId = useId();
  const jobDescId = useId();
  const jobHelpId = useId();
  const bulletInputId = useId();
  const uploadStatusId = useId();
  const atsStatusId = useId();
  const bulletStatusId = useId();
  const headingId = useId();

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
      setFileKey((key) => key + 1);
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

  async function download(docId: string) {
    try {
      const res = await fetch(`/api/resume/${docId}/download`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errorText(json?.error, t('downloadFailed')));

      const url = String(json.url || '');
      if (!url) throw new Error(t('downloadFailed'));

      // The signed link opens in a new tab.
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

  const score = atsResult ? Math.max(0, Math.min(100, Math.round(atsResult.atsScore))) : 0;

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <section className={styles.panel} aria-labelledby={headingId}>
          <header className={styles.panelHead}>
            <h2 className={styles.panelTitle} id={headingId}>
              {t('title')}
            </h2>
            <p className={styles.panelDesc}>{t('desc')}</p>
          </header>

          <div className={styles.fields}>
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
                    {d.filename ?? t('document')}
                  </option>
                ))}
              </select>
            </label>

            <div className={styles.upload}>
              <label className="label" htmlFor={fileInputId}>
                {t('file')}
                <input
                  key={fileKey}
                  className={styles.file}
                  type="file"
                  id={fileInputId}
                  accept=".pdf,.docx,.doc"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <button
                className="button"
                type="button"
                onClick={upload}
                disabled={!file || uploading}
                aria-describedby={uploading ? uploadStatusId : undefined}
              >
                {uploading ? t('uploading') : t('upload')}
              </button>
              {uploading ? (
                <span id={uploadStatusId} className="srOnly">
                  {t('uploadingStatus')}
                </span>
              ) : null}
            </div>

            <label className="label" htmlFor={jobDescId}>
              {t('job')}
              <textarea
                className="textarea"
                id={jobDescId}
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                placeholder={t('jobPlaceholder')}
                rows={6}
                aria-describedby={jobHelpId}
              />
              <span id={jobHelpId} className="help">
                {t('jobHelp')}
              </span>
            </label>

            <div className={styles.actions} role="group" aria-label={t('actions')}>
              <button
                className="button buttonPrimary"
                type="button"
                onClick={runATSAnalysis}
                disabled={!selectedDocId || !jobDescription || analyzing}
                aria-describedby={analyzing ? atsStatusId : undefined}
              >
                {analyzing ? t('checking') : t('check')}
              </button>
              <button className="button" type="button" onClick={optimizeKeywords} disabled={!selectedDocId || !jobDescription || analyzing}>
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
            {analyzing ? (
              <span id={atsStatusId} className="srOnly">
                {t('checkingStatus')}
              </span>
            ) : null}
          </div>

          {atsResult ? (
            <section className={styles.result} role="region" aria-labelledby="ats-results-heading">
              <h3 className={styles.resultTitle} id="ats-results-heading">
                {t('matchTitle')}
              </h3>
              <p className={styles.scoreFigure}>
                <span className="srOnly">{t('scoreLabel', { score })}</span>
                <span className={styles.scoreNumber} aria-hidden="true">
                  {score}
                </span>
                <span className={styles.scoreOf} aria-hidden="true">
                  {t('outOf')}
                </span>
              </p>
              <span className={styles.meter} aria-hidden="true">
                <span style={{ transform: `scaleX(${score / 100})` }} />
              </span>
              <div className={styles.keywordGroups}>
                {atsResult.matchedKeywords.length > 0 ? (
                  <div className={styles.keywordGroup}>
                    <h4 className={styles.groupTitle}>{t('matchedLabel')}</h4>
                    <ul className={styles.tags} aria-label={t('matchedLabel')}>
                      {atsResult.matchedKeywords.map((k) => (
                        <li key={k} className={styles.tag}>
                          {k}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {atsResult.missingKeywords.length > 0 ? (
                  <div className={styles.keywordGroup}>
                    <h4 className={styles.groupTitle}>{t('missingLabel')}</h4>
                    <ul className={styles.tags} aria-label={t('missingLabel')}>
                      {atsResult.missingKeywords.slice(0, 10).map((k) => (
                        <li key={k} className={styles.tag} data-missing="true">
                          {k}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
              {atsResult.suggestions.length > 0 ? (
                <div className={styles.keywordGroup}>
                  <h4 className={styles.groupTitle}>{t('suggestions')}</h4>
                  <ul className={styles.points}>
                    {atsResult.suggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {keywordResult ? (
            <section className={styles.result} role="region" aria-labelledby="keyword-results-heading">
              <h3 className={styles.resultTitle} id="keyword-results-heading">
                {t('keywordsTitle')}
              </h3>
              {keywordResult.suggestedKeywords.length ? (
                <ul className={styles.tags} aria-label={t('missingLabel')}>
                  {keywordResult.suggestedKeywords.map((k) => (
                    <li key={k} className={styles.tag} data-missing="true">
                      {k}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.body}>{t('keywordsNone')}</p>
              )}
              <p className="help">{t('keywordsHelp')}</p>
            </section>
          ) : null}
        </section>

        <section className={styles.panel} aria-labelledby="bullet-rewriter-heading">
          <h2 className={styles.panelTitle} id="bullet-rewriter-heading">
            {t('bulletsTitle')}
          </h2>
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
          {analyzing ? (
            <span id={bulletStatusId} className="srOnly">
              {t('bulletsStatus')}
            </span>
          ) : null}
          <div className={styles.actions}>
            <button className="button" type="button" onClick={analyzeBullets} disabled={!selectedDocId || !bulletInput.trim() || analyzing}>
              {analyzing ? t('rewriting') : t('rewrite')}
            </button>
          </div>

          {bulletAnalyses.length > 0 ? (
            <div className={styles.bulletResults} role="region" aria-labelledby="bullet-results-heading">
              <h3 id="bullet-results-heading" className="srOnly">
                {t('rewrittenHeading')}
              </h3>
              <ol className={styles.bullets}>
                {bulletAnalyses.map((analysis, i) => (
                  <li key={i} className={styles.bullet}>
                    <article aria-label={t('analysisLabel', { n: i + 1, total: bulletAnalyses.length })}>
                      <p className={styles.bulletLine}>
                        <span className={styles.bulletLabel}>{t('original')}</span>
                        <span className={styles.bulletOriginal}>{analysis.original}</span>
                      </p>
                      {analysis.rewritten ? (
                        <p className={styles.bulletLine}>
                          <span className={styles.bulletLabel}>{t('rewritten')}</span>
                          <span className={styles.bulletRewritten}>{analysis.rewritten}</span>
                        </p>
                      ) : null}
                      <p className={styles.bulletMeta}>
                        <span className="srOnly">{t('bulletScoreLabel', { score: analysis.score })}</span>
                        <span aria-hidden="true">{t('bulletScore', { score: analysis.score })}</span>
                        {analysis.issues.length > 0 ? <span>{t('issues', { issues: analysis.issues.join(', ') })}</span> : null}
                      </p>
                    </article>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </section>
      </div>

      <aside className={styles.aside} aria-labelledby="history-heading">
        <div className={styles.asideHead}>
          <h2 className={styles.panelTitle} id="history-heading">
            {t('history')}
          </h2>
          <button className="button buttonGhost buttonSmall" type="button" onClick={refreshHistory} aria-label={t('refreshLabel')}>
            {t('refresh')}
          </button>
        </div>

        <section className={styles.asideSection} aria-labelledby="documents-heading">
          <h3 className={styles.sectionTitle} id="documents-heading">
            {t('documents')}
            <span className={styles.count}>{docs.length}</span>
          </h3>
          {docs.length ? (
            <ul className={styles.list} aria-label={t('documentsLabel')}>
              {docs.map((d) => {
                const name = d.filename ?? t('document');
                return (
                  <li key={d.id} className={styles.doc}>
                    <ResumeIcon size={16} className={styles.docIcon} />
                    <span className={styles.docText}>
                      <span className={styles.docName} title={name}>
                        {name}
                      </span>
                      <span className={styles.docMeta}>
                        <span>{when(d.created_at)}</span>
                        {d.ats_score ? <span>{t('docScore', { score: d.ats_score })}</span> : null}
                      </span>
                    </span>
                    <button
                      className="button buttonGhost buttonSmall"
                      type="button"
                      onClick={() => void download(d.id)}
                      aria-label={t('downloadLabel', { name })}
                    >
                      {t('download')}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.hint} aria-live="polite">
              {t('noUploads')}
            </p>
          )}
        </section>

        <section className={styles.asideSection} aria-labelledby="generations-heading">
          <h3 className={styles.sectionTitle} id="generations-heading">
            {t('tailored')}
            <span className={styles.count}>{gens.length}</span>
          </h3>
          {gens.length ? (
            <ul className={styles.list} aria-labelledby="generations-heading">
              {gens.map((g) => {
                const done = g.status === 'completed' && Boolean(g.output?.resume);
                const state = isPending(g) ? 'processing' : done ? 'ready' : 'failed';
                const open = openGen === g.id;
                return (
                  <li key={g.id} className={styles.gen}>
                    <div className={styles.genHead}>
                      <span className={styles.genTitle}>{g.output?.target || t('tailoredFallback')}</span>
                      <span className={styles.status} data-status={state} role="status">
                        <span className={styles.statusDot} aria-hidden="true" />
                        {state === 'processing' ? t('statusWriting') : state === 'ready' ? t('statusReady') : t('statusFailed')}
                      </span>
                    </div>
                    <span className={styles.genMeta}>{when(g.created_at)}</span>
                    {state === 'processing' ? <p className={styles.genNote}>{t('writingNow')}</p> : null}
                    {state === 'failed' ? <p className={styles.genNote}>{t('writeFailed')}</p> : null}
                    {done && g.output.summary ? <p className={styles.genSummary}>{g.output.summary}</p> : null}
                    {done && open ? (
                      <div className={styles.genDetail}>
                        {g.output.changes?.length ? (
                          <div className={styles.keywordGroup}>
                            <h4 className={styles.groupTitle}>{t('changed')}</h4>
                            <ul className={styles.points}>
                              {g.output.changes.map((change, i) => (
                                <li key={i}>{change}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {g.output.keywords?.length ? (
                          <ul className={styles.tags} aria-label={t('coveredLabel')}>
                            {g.output.keywords.map((k) => (
                              <li key={k} className={styles.tag}>
                                {k}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <pre className={styles.tailored}>{g.output.resume}</pre>
                      </div>
                    ) : null}
                    {state !== 'processing' ? (
                      <div className={styles.genActions}>
                        {done ? (
                          <>
                            <button className="button buttonSmall" type="button" onClick={() => setOpenGen(open ? null : g.id)} aria-expanded={open}>
                              {open ? t('hide') : t('show')}
                            </button>
                            <button className="button buttonGhost buttonSmall" type="button" onClick={() => void copyResume(g)}>
                              {t('copy')}
                            </button>
                            <button className="button buttonGhost buttonSmall" type="button" onClick={() => void downloadPdf(g)}>
                              {t('pdf')}
                            </button>
                            <button className="button buttonGhost buttonSmall" type="button" onClick={() => downloadText(g)}>
                              {t('text')}
                            </button>
                          </>
                        ) : null}
                        <button className={`button buttonGhost buttonSmall ${styles.delete}`} type="button" onClick={() => void removeGeneration(g.id)}>
                          {t('delete')}
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.hint}>{t('noTailored')}</p>
          )}
        </section>
      </aside>
    </div>
  );
}
