# CI and security checks

All workflows live in `.github/workflows/`. Every one starts from a read-only
`GITHUB_TOKEN` (`permissions: contents: read`) and grants more per job only where
needed. Every job has a timeout. A new push to a pull request cancels that pull
request's previous run, while each commit on `master` keeps its own run. Actions are
pinned to commit SHAs with the version in a comment, and Dependabot updates both.
Nothing uses `pull_request_target`.

The repository is public, so code scanning (CodeQL and the SARIF uploads),
dependency review and secret scanning cost nothing. If it ever becomes private,
those need GitHub Code Security and Secret Protection (formerly Advanced Security).
Without those licences, the SARIF uploads, CodeQL and dependency review fail.

## Workflows and jobs

"PR" means every pull request; CodeQL runs only on pull requests into `master`.
"Weekly" is Monday early morning UTC. Each scheduled workflow can also be started
by hand (Run workflow).

| Workflow (file) | Job, as shown in checks | Runs | Fails when |
|---|---|---|---|
| CI (`ci.yml`) | `lint_typecheck_test_build` | PR, push to master | ESLint, `tsc`, a Jest test or `next build` fails. Coverage goes to the job summary and the `coverage` artifact; no threshold is set. |
| | Desktop app (typecheck and tests) | PR, push | `desktop/`: `tsc` or a `node --test` test fails |
| | E2E whole app (fake services) | PR, push | A spec in `e2e/app` fails (`playwright.app.config.ts`); the HTML report is uploaded on failure |
| | E2E desktop app (Electron, fake services) | PR, push | On Windows: the desktop app, launched for real, fails a spec in `e2e/desktop` (`playwright.desktop.config.ts`); the HTML report is uploaded on failure |
| | E2E signed-out specs (fake services) | PR, push | A spec in `e2e/*.spec.ts` fails (`playwright.config.ts`); the HTML report is uploaded on failure |
| E2E live loop (`e2e-live.yml`) | Live loop (fake services) | PR, push | The live copilot loop fails against the fakes |
| | Live loop (real services) | Manual, `real = true` | The loop fails against real Supabase, Deepgram and OpenAI (`E2E_*` secrets) |
| CodeQL (`codeql-analysis.yml`) | CodeQL (actions), CodeQL (javascript-typescript) | PR to master, push, weekly | The job itself only fails if the analysis breaks. Results go to code scanning, and GitHub's separate **CodeQL** check fails on new alerts at or above the code scanning threshold. Query suite: `security-extended`. Skips tests and `e2e/`. |
| Semgrep (`semgrep.yml`) | Semgrep scan | PR, push, weekly | A finding of ERROR severity (or CRITICAL/HIGH, the same level in newer rules). All findings go to code scanning (check **Semgrep OSS**). Skipped paths: `.semgrepignore`. |
| Security (`security.yml`) | Dependency review | PR | The PR adds or upgrades to a dependency with a high or critical advisory (runtime or development), or under a license outside the allow list in `.github/dependency-review-config.yml` |
| | OSV-Scanner (lockfiles) | PR, push, weekly | On a PR, a vulnerability the PR introduces (compared with its base branch). On master and weekly it reports everything to code scanning (check **osv-scanner**) and doesn't fail. |
| | npm audit (web app), npm audit (desktop) | PR, push, weekly | A high or critical advisory in production dependencies (`--omit=dev`) |
| | License summary | PR, push, weekly | Never: a table per lockfile in the job summary, warnings for production packages under a strong copyleft, non-commercial or unrecognised license, and the `licenses` artifact |
| | Secret scan (gitleaks, GitGuardian) | PR, push, weekly | Only a GitGuardian finding on a push to master. gitleaks and GitGuardian on PRs only warn. gitleaks skips test code and fixtures (`.github/gitleaks.toml`). |
| Container (`container.yml`) | Docker image (build and Trivy scan) | PR, push, weekly | The `Dockerfile` doesn't build, or Trivy finds a CRITICAL or HIGH vulnerability that has a fix (OS packages or `node_modules`). Results go to code scanning (check **Trivy**). |
| | Dockerfile and config (Trivy config, hadolint) | PR, push, weekly | Trivy finds a CRITICAL or HIGH misconfiguration, or hadolint reports a warning or error |
| Desktop release (`desktop-release.yml`) | Check version and app URL, Build (Windows / macOS) | Tag `desktop-v*`, manual | See the file. It needs the repository variable `APEX_APP_URL`, which isn't set today. |

Dependabot (`.github/dependabot.yml`) opens version updates weekly, on Mondays, for
npm in `/` and `/desktop` and for the workflow actions. Minor and patch updates are
grouped into one pull request per ecosystem and dependency type, while majors come
one by one. Next.js with `eslint-config-next`, and React with `react-dom`, always
move together. A release must be a week old before Dependabot proposes it.

How the Playwright jobs run:

- **E2E whole app:** `playwright.app.config.ts` starts the fakes and the app
  (`npm run dev` on port 3100) itself. The app runs in dev mode and compiles each page
  on its first visit, so this is the slowest job; its timeout is 120 minutes.
- **E2E desktop app:** on `windows-latest`. It installs and builds `desktop/` (its
  `npm ci` brings Electron's binary, which Playwright drives, so no browser is
  installed), and `playwright.desktop.config.ts` starts the fakes and the app like the
  whole-app config. It signs in inside the desktop window, then checks the page's
  bridge, Settings → Desktop app, the floating answer window, the navigation lock and
  the page shown when the server doesn't answer. Where global shortcuts can't be
  registered, it checks the "taken" message instead.
- **E2E signed-out specs:** `playwright.config.ts` starts `npm run dev` on port 3000
  but not the fakes. The job starts `node e2e/fakes/serve.mjs` in the background, then
  writes `fakeAppEnv()` from `e2e/fakes/config.cjs` (with `E2E_APP_PORT=3000`) into
  the job environment, which the app inherits. No real Supabase project or secret is
  involved. CI passes `--timeout=120000` because the cold dev server compiles each
  page on its first visit, which the config's default 30 s per test doesn't allow
  for.

## Running a check locally

From the repository root, after `npm ci` (and `npm ci` in `desktop/` for the desktop
app):

| Check | Command |
|---|---|
| Lint | `npm run lint` |
| Typecheck | `npx tsc -p tsconfig.json --noEmit` |
| Unit tests with coverage | `npm run test:coverage`, then open `coverage/lcov-report/index.html` |
| Production build | `npm run build` (with your `.env.local`, or the placeholder values from the Build step in `ci.yml`) |
| Desktop app | `npm run test:desktop` |
| E2E whole app | `npm run test:e2e:app` (Chromium: `npx playwright install chromium`, or set `CHROMIUM_PATH`) |
| E2E desktop app | `npm --prefix desktop run build`, then `npm run test:e2e:desktop` (not at the same time as the whole-app suite on the same fakes) |
| E2E signed-out specs | `npm run test:e2e` against your own `npm run dev` and `.env.local`. To run them against the fakes as CI does, see below. |
| E2E live loop | `npx playwright test -c playwright.live.config.ts` |
| npm audit | `npm run audit:prod` |
| Licenses | `npm run licenses` |
| OSV-Scanner | `osv-scanner scan source --recursive .` ([install](https://google.github.io/osv-scanner/installation/)) |
| Semgrep | See below (Docker) |
| CodeQL | [CodeQL CLI](https://docs.github.com/en/code-security/codeql-cli): `codeql database create .codeql --language=javascript-typescript --build-mode=none`, then `codeql database analyze .codeql --download codeql/javascript-queries:codeql-suites/javascript-security-extended.qls --format=sarif-latest --output=codeql.sarif` |
| Docker image and Trivy | `docker build -t apex-round:ci --build-arg NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-placeholder-anon-key --build-arg NEXT_PUBLIC_APP_URL=https://example.com .`, then `trivy image --scanners vuln --ignore-unfixed --severity CRITICAL,HIGH apex-round:ci` |
| Trivy config, hadolint | `trivy config --severity CRITICAL,HIGH .` and `docker run --rm -i hadolint/hadolint < Dockerfile` |
| gitleaks | `gitleaks git --config .github/gitleaks.toml` |
| GitGuardian | `ggshield secret scan repo .` (needs `GITGUARDIAN_API_KEY`) |
| Dependency review | GitHub only: it compares the dependency graphs of the two commits of a PR |

The signed-out specs against the fakes, as in CI (bash; stop anything on port 3000
first):

```bash
node e2e/fakes/serve.mjs &
export $(E2E_APP_PORT=3000 node -e "for (const [k, v] of Object.entries(require('./e2e/fakes/config.cjs').fakeAppEnv())) console.log(k + '=' + v)")
CI=1 npx playwright test --timeout=120000
kill %1
```

Semgrep, with the same rulesets as CI (bash or PowerShell; in Git Bash, prefix
`MSYS_NO_PATHCONV=1`):

```bash
docker run --rm -v "${PWD}:/src" semgrep/semgrep:1.183.0 semgrep scan --metrics=off \
  --config=p/default --config=p/typescript --config=p/react --config=p/nextjs \
  --config=p/nodejsscan --config=p/secrets --config=p/owasp-top-ten \
  --config=p/github-actions --config=p/dockerfile --json-output=semgrep.json
node .github/scripts/semgrep-gate.mjs semgrep.json
```

## Repository settings to enable

- [ ] **Branch protection for `master`** (Settings → Rules → Rulesets, or Branches).
  Require a pull request, and require these checks:
  - `lint_typecheck_test_build`, Desktop app (typecheck and tests), E2E whole app
    (fake services), E2E signed-out specs (fake services), Live loop (fake services)
  - CodeQL (actions), CodeQL (javascript-typescript) and the **CodeQL** code scanning
    check
  - Semgrep scan, Dependency review, OSV-Scanner (lockfiles), npm audit (web app),
    npm audit (desktop)
  - Docker image (build and Trivy scan), Dockerfile and config (Trivy config,
    hadolint)

  Also block force pushes and deletions. There is no branch protection or ruleset
  today.
- [ ] **Code scanning:** the results already arrive.
  - Under code scanning's protection rules, choose what fails a pull request (for
    example, security alerts of High or higher).
  - Keep CodeQL *default setup* off: `codeql-analysis.yml` is an advanced setup,
    and GitHub rejects advanced CodeQL uploads while default setup is on.
  - After `codeql-analysis.yml` has run on master, delete the two stale CodeQL
    configurations from `codeql.yml` and `codeql1.yml` (Security → Code scanning →
    Tool status). Until then, pull requests may warn that those configurations are
    missing.
- [ ] **Dependabot alerts:** on.
- [ ] **Dependabot security updates:** switched on, but GitHub reports them as
  **paused**. It pauses Dependabot when its pull requests go unanswered, and #2–#26
  have been open since February to May. Merge or close those (this branch supersedes
  several), then resume security updates in the settings if they haven't restarted.
- [ ] **Secret scanning:** on. **Push protection is off: turn it on.** Optionally,
  also turn on non-provider patterns and validity checks.
- [ ] **Private vulnerability reporting:** on (`SECURITY.md` relies on it).
- [ ] **Actions:** workflow permissions are already read-only by default. Once these
  workflows are on master, turn on "Require actions to be pinned to a full-length
  commit SHA".
- [ ] **Scheduled workflows:** in a public repository, GitHub disables a workflow with
  a `schedule` after 60 days without repository activity. That is what stopped the old
  CodeQL workflows. If CodeQL, Semgrep, Security or Container shows as disabled in the
  Actions tab, enable it again.

## First runs and upkeep

- **GitGuardian on master:** ggshield flags the made-up token in
  `src/lib/__tests__/teamInvites.test.ts` ("Generic High Entropy Secret"). On a pull
  request it only warns. The master step fails on it, and that step now scans every
  commit of the push rather than only the last one. Before merging, add a
  `.gitguardian.yaml` at the repository root (it's there now; ggshield reads it there; the action
  can't be pointed at a file elsewhere):

  ```yaml
  version: 2
  secret:
    ignored_paths:
      - '**/__tests__/**'
      - '**/*.test.ts'
      - '**/*.test.tsx'
      - 'e2e/**'
  ```
- **New scanners:** Semgrep, Trivy and dependency review have never run on this code.
  Their first runs may report real issues or false positives:
  - Semgrep: fix the finding, or add `// nosemgrep: <rule-id> -- <reason>` on the line
    above it. Semgrep still writes marked findings to its SARIF as suppressed, so the
    workflow leaves them out before the upload (`.github/scripts/sarif-drop-suppressed.mjs`);
    otherwise code scanning would open alerts for them anyway.
  - Trivy: fix the finding (for example, update the base image). If there is no fix
    in reach, list the CVE in a `.trivyignore` at the repository root, which Trivy
    reads by default. Add a comment with the reason and an expiry, for example
    `CVE-2026-12345 exp:2027-01-31`.
  - Dependency review: list a reviewed package under `allow-dependencies-licenses`
    or `allow-ghsas` in its config.
- **Versions not tracked by Dependabot:**
  - The Semgrep image (`SEMGREP_IMAGE` in `semgrep.yml`) is run with `docker run`:
    bump it by hand.
  - Trivy's own version is trivy-action's default, so it moves when Dependabot bumps
    the action.
