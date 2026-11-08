#!/usr/bin/env node
// Copies a SARIF file without its suppressed results, for the Semgrep workflow
// (.github/workflows/semgrep.yml) to upload to code scanning.
//
//   node .github/scripts/sarif-drop-suppressed.mjs semgrep.sarif semgrep.upload.sarif
//
// (A separate output file: Semgrep's container writes its files as root.)
//
// A finding marked `nosemgrep` in the code, each with its reason next to it, is
// already left out of Semgrep's text and JSON output, but Semgrep still writes it
// to the SARIF as a suppressed result, and code scanning opens an alert for it
// anyway. The annotation in the code, reviewed like any other change, is the record.

import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2] ?? 'semgrep.sarif';
const output = process.argv[3] ?? file;
let sarif;
try {
  sarif = JSON.parse(readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

/** Suppressed: at least one suppression that's accepted (SARIF's default when no state is given). */
const suppressed = (result) => (result.suppressions ?? []).some((s) => (s.state ?? 'accepted') === 'accepted');

let dropped = 0;
for (const run of sarif.runs ?? []) {
  const results = run.results ?? [];
  run.results = results.filter((result) => !suppressed(result));
  dropped += results.length - run.results.length;
}
writeFileSync(output, JSON.stringify(sarif));
console.log(`${output}: ${file} without the ${dropped} finding(s) marked nosemgrep in the code`);
