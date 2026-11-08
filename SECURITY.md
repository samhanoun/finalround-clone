# Security policy

## Reporting a vulnerability

Please don't report security problems in a public issue, pull request or discussion.
Report them privately through GitHub's private vulnerability reporting instead: open
the repository's **Security** tab and choose **Report a vulnerability**, or go
straight to
<https://github.com/samhanoun/finalround-clone/security/advisories/new>.

A useful report says:

- what is affected: a page or API route of the web app, the speech-to-text relay, a
  database policy, the desktop app (with its version), or a CI workflow
- how to reproduce it, step by step, ideally with a minimal proof of concept
- what an attacker gains: for example, reading another user's data, or acting as
  them
- any fix you'd suggest

If you found a leaked credential, say where it is. Please don't use it.

When testing, please:

- only use accounts you own, and don't read or change other people's data
- don't degrade the service: no load or denial-of-service testing, no spam
- give us reasonable time to fix the problem before you disclose it

You'll get an acknowledgement, normally within five working days, and updates as we
assess and fix the issue. Fixes are published as a GitHub security advisory. We'll
credit you there unless you'd rather stay anonymous.

## Supported versions

| Component | Gets security fixes |
|---|---|
| Web app (Next.js app, API routes, `server.ts` and its WebSocket relay) | The current deployment from `master` only |
| Desktop app (`desktop/`, Windows and macOS) | The latest published `desktop-v*` release. Installed apps update themselves from GitHub Releases; older versions don't get fixes. |
| Database schema and policies (`supabase/`) | The latest migrations on `master` |

In scope is the code in this repository. Problems in the third-party services
themselves belong with those vendors: Supabase, Stripe, Deepgram, OpenAI, Anthropic,
Google and SendGrid. A way to misuse them through this app is in scope.

## What the automated checks cover

Every pull request and every push to `master` runs these checks, and most also run
weekly. [docs/ci.md](docs/ci.md) has the details and how to run each one locally.

- **Static analysis:** CodeQL (`security-extended` queries) on the
  JavaScript/TypeScript code and the GitHub Actions workflows. Semgrep with the
  default, TypeScript, React, Next.js, nodejsscan, secrets, OWASP Top 10, GitHub
  Actions and Dockerfile rulesets.
- **Dependencies:**
  - Dependency review on pull requests: known vulnerabilities, plus a license allow
    list.
  - OSV-Scanner over both lockfiles.
  - `npm audit` of the production dependencies of the web and desktop apps.
  - A license summary.
  - Dependabot alerts, and Dependabot version and security updates.
- **Container:** the Docker image is built and scanned with Trivy for fixable
  critical and high vulnerabilities. Trivy's misconfiguration scan and hadolint check
  the `Dockerfile`.
- **Secrets:** GitHub secret scanning, gitleaks and GitGuardian (ggshield).
- **Tests:** unit tests (with coverage reports), the desktop app's tests, and
  end-to-end tests. The end-to-end tests run against local fakes of Supabase,
  Deepgram and OpenAI, including signed-out access to the copilot APIs.

These checks reduce risk; they don't prove the absence of vulnerabilities, so
reports are very welcome.
