#!/usr/bin/env node
// License summary of the npm dependency trees, read from the lockfiles alone:
// npm records each package's license in package-lock.json, so this needs no
// install and no extra dependency.
//
//   node .github/scripts/license-summary.mjs [--json licenses.json] [lockfile ...]
//   npm run licenses
//
// Reads package-lock.json and desktop/package-lock.json unless lockfiles are
// given. Prints a Markdown report (also appended to the job summary in GitHub
// Actions) and warns about production packages under a strong copyleft,
// non-commercial or unrecognised license. It never fails on a license: on pull
// requests the dependency review (.github/dependency-review-config.yml) is the
// gate. Exits 1 only when a lockfile can't be read.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

// Most permissive first: an "A OR B" expression takes the better side, "A AND B" the worse.
const KINDS = ['permissive', 'weak-copyleft', 'unrecognised', 'restricted'];
const LABELS = {
  permissive: 'permissive',
  'weak-copyleft': 'weak copyleft',
  unrecognised: 'unrecognised',
  restricted: 'strong copyleft or restricted',
};
const RESTRICTED = /^(A?GPL|SSPL|EUPL|OSL|CPAL|RPL|Sleepycat|CC-BY-NC|CC-BY-ND|BUSL|Elastic|PolyForm|Commons-Clause)/i;
const WEAK_COPYLEFT = /^(LGPL|MPL|EPL|CDDL|CC-BY-SA|MS-RL|Artistic)/i;
const PERMISSIVE =
  /^(MIT|ISC|Apache-|BSD|0BSD|BlueOak-|CC0-|CC-BY-\d|Unlicense|Zlib|Python-|PSF-|WTFPL|BSL-1\.0|X11|Unicode-|OFL-|Public Domain)/i;

const bestOf = (kinds) => KINDS[Math.min(...kinds.map((kind) => KINDS.indexOf(kind)))];
const worstOf = (kinds) => KINDS[Math.max(...kinds.map((kind) => KINDS.indexOf(kind)))];

/** Whether the whole of `text` sits inside one pair of parentheses. */
function isWrapped(text) {
  if (!text.startsWith('(') || !text.endsWith(')')) return false;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
    if (depth === 0 && i < text.length - 1) return false;
  }
  return true;
}

/** Splits an SPDX expression on `operator` (OR, AND) outside parentheses. */
function splitTopLevel(text, operator) {
  const needle = ` ${operator} `;
  const upper = text.toUpperCase();
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
    else if (depth === 0 && upper.startsWith(needle, i)) {
      parts.push(text.slice(start, i));
      start = i + needle.length;
      i = start - 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim());
}

function classify(expression) {
  let text = expression.trim();
  while (isWrapped(text)) text = text.slice(1, -1).trim();
  if (!text) return 'unrecognised';
  const alternatives = splitTopLevel(text, 'OR');
  if (alternatives.length > 1) return bestOf(alternatives.map(classify));
  const terms = splitTopLevel(text, 'AND');
  if (terms.length > 1) return worstOf(terms.map(classify));
  const id = text.replace(/\s+WITH\s+.*$/i, '').replace(/\+$/, '');
  if (/^SEE LICENSE IN\b/i.test(id) || /^UNLICENSED$/i.test(id)) return 'unrecognised';
  if (RESTRICTED.test(id)) return 'restricted';
  if (WEAK_COPYLEFT.test(id)) return 'weak-copyleft';
  if (PERMISSIVE.test(id)) return 'permissive';
  return 'unrecognised';
}

/** One entry per name@version; `dev` only when every copy is development-only. */
function readPackages(lockfile) {
  const lock = JSON.parse(readFileSync(lockfile, 'utf8'));
  if (!lock.packages) throw new Error(`${lockfile} has no "packages" section (lockfileVersion 2 or 3 needed)`);
  const packages = new Map();
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!location || entry.link) continue;
    const marker = location.lastIndexOf('node_modules/');
    const name = entry.name ?? (marker === -1 ? location : location.slice(marker + 'node_modules/'.length));
    const raw = typeof entry.license === 'string' ? entry.license : entry.license?.type;
    const license = raw?.trim() || 'UNKNOWN';
    const key = `${name}@${entry.version}`;
    const seen = packages.get(key);
    if (seen) {
      seen.dev &&= Boolean(entry.dev);
      seen.optional &&= Boolean(entry.optional);
      continue;
    }
    packages.set(key, {
      name,
      version: entry.version,
      license,
      kind: classify(license),
      dev: Boolean(entry.dev),
      optional: Boolean(entry.optional),
    });
  }
  return [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

const cell = (text) => text.replaceAll('|', '\\|');

function report(lockfile, packages) {
  const rows = new Map();
  for (const pkg of packages) {
    const row = rows.get(pkg.license) ?? { license: pkg.license, kind: pkg.kind, production: 0, development: 0 };
    row[pkg.dev ? 'development' : 'production'] += 1;
    rows.set(pkg.license, row);
  }
  const production = packages.filter((pkg) => !pkg.dev);
  const lines = [
    `### Licenses in ${lockfile}`,
    '',
    `${packages.length} packages: ${production.length} production, ${packages.length - production.length} development only.`,
    '',
    '| License | Kind | Production | Development |',
    '|---|---|---:|---:|',
    ...[...rows.values()]
      .sort((a, b) => b.production - a.production || b.development - a.development || a.license.localeCompare(b.license))
      .map((row) => `| ${cell(row.license)} | ${LABELS[row.kind]} | ${row.production} | ${row.development} |`),
  ];
  const notPermissive = production.filter((pkg) => pkg.kind !== 'permissive');
  if (notPermissive.length > 0) {
    lines.push('', 'Production packages that are not plainly permissive:', '');
    for (const pkg of notPermissive) {
      const notes = [LABELS[pkg.kind], ...(pkg.optional ? ['optional'] : [])].join(', ');
      lines.push(`- \`${pkg.name}@${pkg.version}\`: ${cell(pkg.license)} (${notes})`);
    }
  }
  const review = production.filter((pkg) => pkg.kind === 'restricted' || pkg.kind === 'unrecognised');
  return { markdown: `${lines.join('\n')}\n\n`, review };
}

/** A GitHub Actions warning annotation, or a plain line elsewhere. */
function warn(message) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    const data = message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
    console.log(`::warning title=License review::${data}`);
  } else {
    console.warn(`warning: ${message}`);
  }
}

const args = process.argv.slice(2);
const lockfiles = [];
let jsonPath;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--json') {
    jsonPath = args[i + 1];
    i += 1;
  } else {
    lockfiles.push(args[i]);
  }
}
if (args.includes('--json') && !jsonPath) {
  console.error('--json needs a file name');
  process.exit(2);
}

const results = {};
let markdown = '';
for (const lockfile of lockfiles.length > 0 ? lockfiles : ['package-lock.json', 'desktop/package-lock.json']) {
  let packages;
  try {
    packages = readPackages(lockfile);
  } catch (error) {
    console.error(`Cannot read ${lockfile}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  const { markdown: section, review } = report(lockfile, packages);
  markdown += section;
  for (const pkg of review) {
    warn(`${lockfile}: ${pkg.name}@${pkg.version} is a production dependency under "${pkg.license}" (${LABELS[pkg.kind]}). Check it is acceptable for a commercial app.`);
  }
  results[lockfile] = packages;
}

process.stdout.write(markdown);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(results, null, 2)}\n`);
