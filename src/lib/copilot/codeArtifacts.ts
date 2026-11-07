import { splitCodeFences } from './answerText';

/**
 * The code panel: every answer that contains code adds a version to that
 * problem, so the candidate can flip between the first attempt and a later
 * fix ("now make it O(n)"). Solve screen answers share one problem; spoken
 * questions are grouped by their text.
 */

export type CodeRevision = { version: number; lang: string; code: string; at: number };
export type CodeArtifact = { key: string; title: string; revisions: CodeRevision[] };

export const MAX_ARTIFACTS = 12;

export function problemKey(question: { text: string; via?: string }): string {
  if (question.via === 'screen') return 'screen';
  return question.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 80);
}

/** The code blocks of an answer (diagrams aren't code), joined when there are several. */
export function answerCode(text: string): { lang: string; code: string } | null {
  const blocks = splitCodeFences(text).filter(
    (segment): segment is Extract<ReturnType<typeof splitCodeFences>[number], { kind: 'code' }> =>
      segment.kind === 'code' && !segment.open && segment.lang !== 'diagram' && segment.code.trim() !== '',
  );
  if (!blocks.length) return null;
  return { lang: blocks[0].lang, code: blocks.map((block) => block.code).join('\n\n') };
}

/** Adds the answer's code as the next version of its problem; unchanged code adds nothing. */
export function addRevision(
  artifacts: CodeArtifact[],
  question: { text: string; via?: string },
  answerText: string,
  at: number,
): CodeArtifact[] {
  const code = answerCode(answerText);
  if (!code) return artifacts;
  const key = problemKey(question);
  const existing = artifacts.find((artifact) => artifact.key === key);
  if (existing) {
    const last = existing.revisions[existing.revisions.length - 1];
    if (last && last.code === code.code) return artifacts;
    const updated = { ...existing, revisions: [...existing.revisions, { version: existing.revisions.length + 1, ...code, at }] };
    return [updated, ...artifacts.filter((artifact) => artifact.key !== key)];
  }
  const title = question.via === 'screen' ? '' : question.text.slice(0, 120);
  return [{ key, title, revisions: [{ version: 1, ...code, at }] }, ...artifacts].slice(0, MAX_ARTIFACTS);
}
