/**
 * Splits an answer into prose and fenced code blocks so code renders as code
 * in the answer window. Works on partial text while it streams: an unclosed
 * fence is a code block that is still being written.
 */

export type AnswerSegment =
  | { kind: 'text'; text: string }
  | { kind: 'code'; lang: string; code: string; open: boolean };

const OPENING_FENCE = /^ {0,3}```\s*([\w#+.-]*)\s*$/;
const CLOSING_FENCE = /^ {0,3}```\s*$/;

export function splitCodeFences(text: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let prose: string[] = [];
  let code: { lang: string; lines: string[] } | null = null;

  const flushProse = () => {
    const joined = prose.join('\n');
    if (joined.trim()) segments.push({ kind: 'text', text: joined.replace(/^\n+|\n+$/g, '') });
    prose = [];
  };

  for (const line of text.split('\n')) {
    if (code) {
      if (CLOSING_FENCE.test(line)) {
        segments.push({ kind: 'code', lang: code.lang, code: code.lines.join('\n'), open: false });
        code = null;
      } else {
        code.lines.push(line);
      }
      continue;
    }
    const opening = OPENING_FENCE.exec(line);
    if (opening) {
      flushProse();
      code = { lang: opening[1].toLowerCase(), lines: [] };
    } else {
      prose.push(line);
    }
  }

  if (code) segments.push({ kind: 'code', lang: code.lang, code: code.lines.join('\n'), open: true });
  else flushProse();
  return segments;
}
