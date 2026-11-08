// Writes docs/API.md from the route files under src/app/api, so the reference
// can't drift from the code.
//   node scripts/gen-api-docs.mjs
//
// For each route.ts it lists the exported HTTP methods, each with the comment
// written right above its handler (or a `// METHOD /api/... - text` line).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = path.join(ROOT, 'src', 'app', 'api');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name.startsWith('_') ? [] : walk(full);
    return entry.name === 'route.ts' ? [full] : [];
  });
}

// Fixed patterns that capture the method, rather than a RegExp built for each one.
const HANDLER = /^export\s+(?:async\s+function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/;
const EXPORTED = /export\s+(?:async\s+function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
const RE_EXPORTED = /export\s+\{([^}]*)\}\s+from/g;
const METHOD_WORD = /\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
const PREFIX = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+\s*[-—:]?\s*/;
const METHOD_COMMENT = /^\s*(?:\/\/|\*)\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(?:or\s+\w+\s+)?\S*\s*[-—:]\s*(.+)$/;
const COMMENT_MARKERS = ['/**', '*/', '*', '//'];

/** The HTTP methods a route file exports, in METHODS order: its own handlers and names it re-exports. */
function exportedMethods(source) {
  const found = new Set();
  for (const match of source.matchAll(EXPORTED)) found.add(match[1]);
  for (const match of source.matchAll(RE_EXPORTED)) for (const name of match[1].match(METHOD_WORD) ?? []) found.add(name);
  return METHODS.filter((method) => found.has(method));
}

/** A comment line's text, without its leading marker or a closing star-slash. */
function commentText(line) {
  let text = line.trimStart();
  const marker = COMMENT_MARKERS.find((m) => text.startsWith(m));
  if (marker) text = text.slice(marker.length);
  text = text.trimEnd();
  if (text.endsWith('*/')) text = text.slice(0, -2);
  return text.trim();
}

/** The comment block directly above line `at` (a JSDoc block or consecutive // lines), as text. */
function commentAbove(lines, at) {
  let i = at - 1;
  const block = [];
  if (i >= 0 && lines[i].trimEnd().endsWith('*/')) {
    while (i >= 0 && !lines[i].includes('/**')) block.unshift(lines[i--]);
    if (i >= 0) block.unshift(lines[i]);
  } else {
    while (i >= 0 && lines[i].trimStart().startsWith('//')) block.unshift(lines[i--]);
  }
  return block
    .map(commentText)
    .filter((line) => line && !line.startsWith('@'))
    .join(' ');
}

/** The comment without the "METHOD /api/path -" it starts with, when it names this method. */
function withoutPrefix(text, method) {
  const prefix = PREFIX.exec(text);
  return prefix && prefix[1] === method ? text.slice(prefix[0].length) : text;
}

function describe(source, method) {
  const lines = source.split('\n');
  const at = lines.findIndex((line) => HANDLER.exec(line)?.[1] === method);
  if (at > 0) {
    const text = withoutPrefix(commentAbove(lines, at), method).trim();
    if (text) return (text.split(/(?<=\.)\s/)[0] ?? '').trim();
  }
  for (const line of lines) {
    const m = METHOD_COMMENT.exec(line);
    if (m && m[1] === method) return m[2].trim();
  }
  return '';
}

const rows = walk(API)
  .map((file) => {
    const rel = path.relative(path.join(ROOT, 'src', 'app'), path.dirname(file)).split(path.sep).join('/');
    const source = fs.readFileSync(file, 'utf8');
    return { route: `/${rel}`, methods: exportedMethods(source), source };
  })
  .filter((row) => row.methods.length)
  .sort((a, b) => a.route.localeCompare(b.route));

const groups = new Map();
for (const row of rows) {
  const area = row.route.split('/')[2];
  if (!groups.has(area)) groups.set(area, []);
  groups.get(area).push(row);
}

const out = [
  '# API reference',
  '',
  'Generated from the route files in `src/app/api` by `node scripts/gen-api-docs.mjs`. Don’t edit it by hand: change the comment above the route’s handler and run the script again.',
  '',
  'Every route answers JSON. Signed-in routes read the Supabase session cookie; most also apply rate limits and validate bodies with zod. Cron routes take `Authorization: Bearer <CRON_SECRET>`; the Stripe webhook checks Stripe’s signature. The live transcription relay is a WebSocket at `/api/stt/stream`, served by `server.ts` rather than a route file.',
  '',
];
for (const [area, list] of groups) {
  out.push(`## ${area}`, '', '| Method | Path | What it does |', '| --- | --- | --- |');
  for (const row of list) {
    for (const method of row.methods) {
      // Backslashes first, so a backslash before a pipe can't undo the pipe's escape and split the cell.
      const text = describe(row.source, method).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
      out.push(`| \`${method}\` | \`${row.route}\` | ${text} |`);
    }
  }
  out.push('');
}
fs.writeFileSync(path.join(ROOT, 'docs', 'API.md'), out.join('\n'));
const missing = rows.reduce((n, row) => n + row.methods.filter((m) => !describe(row.source, m)).length, 0);
console.log(`docs/API.md: ${rows.length} routes in ${groups.size} areas, ${missing} handlers without a comment`);
