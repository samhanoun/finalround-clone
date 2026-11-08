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

const handlerLine = (method) => new RegExp(String.raw`^export\s+(?:async\s+function\s+${method}\b|const\s+${method}\b)`);
const methodPrefix = (method) => new RegExp(String.raw`^${method}\s+\S+\s*[-—:]?\s*`);
const methodComment = (method) => new RegExp(String.raw`^\s*(?:\/\/|\*)\s*${method}\s+(?:or\s+\w+\s+)?\S*\s*[-—:]\s*(.+)$`);

/** The comment block directly above line `at` (a JSDoc block or consecutive // lines), as text. */
function commentAbove(lines, at) {
  let i = at - 1;
  const block = [];
  if (i >= 0 && /\*\/\s*$/.test(lines[i])) {
    while (i >= 0 && !/\/\*\*/.test(lines[i])) block.unshift(lines[i--]);
    if (i >= 0) block.unshift(lines[i]);
  } else {
    while (i >= 0 && /^\s*\/\//.test(lines[i])) block.unshift(lines[i--]);
  }
  return block
    .map((line) => line.replace(/^\s*(?:\/\*\*|\*\/|\*|\/\/)\s?/, '').replace(/\*\/\s*$/, '').trim())
    .filter((line) => line && !line.startsWith('@'))
    .join(' ');
}

function describe(source, method) {
  const lines = source.split('\n');
  const at = lines.findIndex((line) => handlerLine(method).test(line));
  if (at > 0) {
    const text = commentAbove(lines, at).replace(methodPrefix(method), '').trim();
    if (text) return (text.split(/(?<=\.)\s/)[0] ?? '').trim();
  }
  for (const line of lines) {
    const m = methodComment(method).exec(line);
    if (m) return m[1].trim();
  }
  return '';
}

const rows = walk(API)
  .map((file) => {
    const rel = path.relative(path.join(ROOT, 'src', 'app'), path.dirname(file)).split(path.sep).join('/');
    const source = fs.readFileSync(file, 'utf8');
    const methods = METHODS.filter((m) =>
      new RegExp(String.raw`export\s+(?:async\s+function\s+${m}\b|const\s+${m}\b|\{[^}]*\b${m}\b[^}]*\}\s+from)`).test(source),
    );
    return { route: `/${rel}`, methods, source };
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
      const text = describe(row.source, method).replace(/\|/g, '\\|');
      out.push(`| \`${method}\` | \`${row.route}\` | ${text} |`);
    }
  }
  out.push('');
}
fs.writeFileSync(path.join(ROOT, 'docs', 'API.md'), out.join('\n'));
const missing = rows.reduce((n, row) => n + row.methods.filter((m) => !describe(row.source, m)).length, 0);
console.log(`docs/API.md: ${rows.length} routes in ${groups.size} areas, ${missing} handlers without a comment`);
