# finalround-clone

Next.js (App Router, TypeScript) + Supabase starter for a “FinalRound” style app.

## Features

- Supabase (SSR auth via `@supabase/ssr`)
- SQL migrations (schema + RLS)
  - `0001_init.sql` (initial tables)
  - `0002_mvp_spec.sql` (MVP spec tables)
- Tables (MVP):
  - `profiles`
  - `llm_settings`
  - `interview_sessions`, `interview_session_messages`, `interview_session_feedback`
  - `resume_documents`, `resume_generations`
  - `jobs` (LLM execution tracking)
- Server-only API endpoints:
  - `POST /api/llm` (provider abstraction; currently OpenAI)
  - Interviews: CRUD + messages + score + export
  - Resume: upload + generate + history
- Input validation: **zod**
- Basic in-memory rate limit (per-IP)

## Requirements

- Node.js 18+ (recommended: 20+)
- A Supabase project (cloud) OR local Supabase via Supabase CLI

## Setup

### 1) Install deps

```bash
npm install
```

### 2) Configure env

Copy `.env.example` to `.env.local` and fill values:

```bash
cp .env.example .env.local
```

Env vars:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only; required for `/api/resume/upload` storage upload)
- `LLM_PROVIDER` (currently `openai`)
- `OPENAI_API_KEY`

### 3) Apply database migrations

Migrations are in:

- `supabase/migrations/0001_init.sql`

If you use Supabase CLI:

```bash
supabase init
supabase link --project-ref <your-project-ref>
supabase db push
```

Or apply the SQL directly in Supabase SQL Editor.

### 4) Run dev server

```bash
npm run dev
```

Open http://localhost:3000

## Notes

- The API routes rely on the user being authenticated (Supabase session cookies).
- Rate limiting is intentionally simple (in-memory). It resets on server restart and isn’t suitable for multi-instance deployments.
- No secrets are committed. Keep keys in `.env.local` only.
