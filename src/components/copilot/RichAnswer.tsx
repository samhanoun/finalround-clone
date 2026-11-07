'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { tokenizeCode } from '@/lib/copilot/highlight';
import { layoutDiagram, parseDiagram } from '@/lib/copilot/diagram';
import type { CodeArtifact } from '@/lib/copilot/codeArtifacts';
import styles from './RichAnswer.module.css';

/** A code block with syntax colours; the text itself is unchanged. */
export function HighlightedCode({ code, lang, className }: { code: string; lang?: string; className?: string }) {
  const tokens = useMemo(() => tokenizeCode(code, lang), [code, lang]);
  return (
    <pre className={className} data-lang={lang || undefined}>
      <code>
        {tokens.map((token, index) =>
          token.type === 'plain' ? (
            token.text
          ) : (
            <span key={index} className={styles[token.type]}>
              {token.text}
            </span>
          ),
        )}
      </code>
    </pre>
  );
}

const BOX_W = 132;
const BOX_H = 40;
const GAP_X = 56;
const GAP_Y = 22;

/** A system-design diagram from a ```diagram block: boxes in layers, arrows with labels. */
export function DiagramView({ source }: { source: string }) {
  const t = useTranslations('Answer');
  const layout = useMemo(() => layoutDiagram(parseDiagram(source)), [source]);
  if (!layout.nodes.length) return null;
  const width = layout.layers * BOX_W + (layout.layers - 1) * GAP_X + 8;
  const height = layout.rows * BOX_H + (layout.rows - 1) * GAP_Y + 8;
  const position = new Map(
    layout.nodes.map((node) => [node.id, { x: 4 + node.layer * (BOX_W + GAP_X), y: 4 + node.row * (BOX_H + GAP_Y) }]),
  );
  return (
    <figure className={styles.diagram}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={t('diagramLabel', { count: layout.nodes.length })}>
        <defs>
          <marker id="apex-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className={styles.arrowHead} />
          </marker>
        </defs>
        {layout.edges.map((edge, index) => {
          const from = position.get(edge.from);
          const to = position.get(edge.to);
          if (!from || !to) return null;
          const backwards = to.x <= from.x;
          const x1 = backwards ? from.x + BOX_W / 2 : from.x + BOX_W;
          const y1 = backwards ? from.y + BOX_H : from.y + BOX_H / 2;
          const x2 = backwards ? to.x + BOX_W / 2 : to.x;
          const y2 = backwards ? to.y + BOX_H : to.y + BOX_H / 2;
          const midX = (x1 + x2) / 2;
          const path = backwards
            ? `M${x1} ${y1} C ${x1} ${y1 + 30}, ${x2} ${y2 + 30}, ${x2} ${y2}`
            : `M${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
          return (
            <g key={index}>
              <path d={path} className={styles.edge} markerEnd="url(#apex-arrow)" />
              {edge.label ? (
                <text x={midX} y={(y1 + y2) / 2 - 5} className={styles.edgeLabel} textAnchor="middle">
                  {edge.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {layout.nodes.map((node) => {
          const p = position.get(node.id)!;
          return (
            <g key={node.id}>
              <rect x={p.x} y={p.y} width={BOX_W} height={BOX_H} rx={8} className={styles.box} />
              <text x={p.x + BOX_W / 2} y={p.y + BOX_H / 2 + 4} className={styles.boxLabel} textAnchor="middle">
                {node.label.length > 20 ? `${node.label.slice(0, 19)}…` : node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Text with the answer's source tags ([S1]…) shown as small marks instead of raw brackets. */
export function WithSourceMarks({ text }: { text: string }) {
  const parts = text.split(/(\[S\d+\])/g);
  return (
    <>
      {parts.map((part, index) =>
        /^\[S\d+\]$/.test(part) ? (
          <sup key={index} className={styles.sourceMark}>
            {part.slice(1, -1)}
          </sup>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** The code panel: each coding problem of the session, with every version the copilot wrote. */
export function CodePanel({ artifacts }: { artifacts: CodeArtifact[] }) {
  const t = useTranslations('Answer');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [versionByKey, setVersionByKey] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState(false);
  const artifact = artifacts.find((item) => item.key === selectedKey) ?? artifacts[0];
  if (!artifact) return <p className="small">{t('noCode')}</p>;
  const version = versionByKey[artifact.key] ?? artifact.revisions.length;
  const revision = artifact.revisions[version - 1] ?? artifact.revisions[artifact.revisions.length - 1];

  async function copy() {
    try {
      await navigator.clipboard.writeText(revision.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={styles.codePanel}>
      {artifacts.length > 1 ? (
        <label className={styles.problemPicker}>
          <span className="srOnly">{t('problem')}</span>
          <select className="select" value={artifact.key} onChange={(e) => setSelectedKey(e.target.value)}>
            {artifacts.map((item) => (
              <option key={item.key} value={item.key}>
                {item.title || t('screenProblem')}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className={styles.problemTitle}>{artifact.title || t('screenProblem')}</p>
      )}
      <div className={styles.versions} role="tablist" aria-label={t('versions')}>
        {artifact.revisions.map((item) => (
          <button
            key={item.version}
            type="button"
            role="tab"
            aria-selected={item.version === revision.version}
            className={styles.versionTab}
            onClick={() => setVersionByKey({ ...versionByKey, [artifact.key]: item.version })}
          >
            v{item.version}
          </button>
        ))}
        <button type="button" className="button buttonGhost" onClick={() => void copy()} style={{ marginLeft: 'auto' }}>
          {copied ? t('copied') : t('copy')}
        </button>
      </div>
      <HighlightedCode code={revision.code} lang={revision.lang} className={styles.codeBlock} />
    </div>
  );
}
