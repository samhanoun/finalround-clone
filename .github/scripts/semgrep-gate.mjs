#!/usr/bin/env node
// Reads Semgrep's JSON output and fails on ERROR-severity findings, for the
// Semgrep workflow (.github/workflows/semgrep.yml).
//
//   node .github/scripts/semgrep-gate.mjs semgrep.json
//
// Writes a table of findings per severity, and the blocking findings, to the
// job summary (stdout outside GitHub Actions), adds one error annotation per
// blocking finding and exits 1 if there is any. ERROR is Semgrep's top
// severity; newer rules may call the same level CRITICAL or HIGH, so those
// block too.

import { appendFileSync, readFileSync } from 'node:fs';

const BLOCKING = new Set(['ERROR', 'CRITICAL', 'HIGH']);
const ORDER = ['CRITICAL', 'ERROR', 'HIGH', 'WARNING', 'MEDIUM', 'INFO', 'LOW'];
const inActions = process.env.GITHUB_ACTIONS === 'true';

const file = process.argv[2] ?? 'semgrep.json';
let output;
try {
  output = JSON.parse(readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`Cannot read Semgrep's results from ${file}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
const results = Array.isArray(output.results) ? output.results : [];
const errors = Array.isArray(output.errors) ? output.errors : [];

// Escaping for workflow commands, as @actions/core does it.
const data = (text) => String(text).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
const property = (text) => data(text).replaceAll(':', '%3A').replaceAll(',', '%2C');
const severityOf = (result) => String(result.extra?.severity ?? 'UNKNOWN').toUpperCase();
const rank = (severity) => (ORDER.includes(severity) ? ORDER.indexOf(severity) : ORDER.length);

const counts = new Map();
for (const result of results) counts.set(severityOf(result), (counts.get(severityOf(result)) ?? 0) + 1);
const blocking = results.filter((result) => BLOCKING.has(severityOf(result)));

const lines = ['### Semgrep', ''];
if (results.length === 0) {
  lines.push('No findings.');
} else {
  lines.push('| Severity | Findings |', '|---|---:|');
  for (const [severity, count] of [...counts].sort((a, b) => rank(a[0]) - rank(b[0]))) lines.push(`| ${severity} | ${count} |`);
}
if (blocking.length > 0) {
  lines.push('', 'Blocking findings:', '');
  for (const result of blocking) lines.push(`- \`${result.path}:${result.start?.line ?? '?'}\` ${result.check_id}`);
}
if (errors.length > 0) {
  lines.push('', `Semgrep also reported ${errors.length} problem(s) of its own (a file it couldn't parse, a rule that timed out): see the Scan step's log.`);
}
const summary = `${lines.join('\n')}\n`;
if (inActions && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
else process.stdout.write(summary);

for (const result of blocking) {
  const line = result.start?.line ?? 1;
  const where = `${result.path}:${line}`;
  const message = result.extra?.message ?? result.check_id;
  if (inActions) {
    console.log(
      `::error file=${property(result.path)},line=${line},endLine=${result.end?.line ?? line},title=${property(result.check_id)}::${data(message)}`,
    );
  } else {
    console.log(`error: ${where} ${result.check_id}: ${message}`);
  }
}

if (blocking.length > 0) {
  const message = `${blocking.length} ERROR-severity finding(s) out of ${results.length}. Fix them, or mark a reviewed false positive with a "// nosemgrep: <rule-id>" comment that says why.`;
  console.log(inActions ? `::error title=Semgrep::${data(message)}` : message);
  process.exit(1);
}
console.log(`${results.length} finding(s), none of ERROR severity.`);
