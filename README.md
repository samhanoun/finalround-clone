# Apex Round — AI Interview & Job Search Copilot Platform

<p align="center">
  <a href="https://nextjs.org">
    <img src="https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js" alt="Next.js">
  </a>
  <a href="https://supabase.com">
    <img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase" alt="Supabase">
  </a>
  <a href="https://www.typescriptlang.org">
    <img src="https://img.shields.io/badge/TypeScript-5.9-blue?style=for-the-badge&logo=typescript" alt="TypeScript">
  </a>
  <a href="https://openai.com">
    <img src="https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai" alt="OpenAI">
  </a>
</p>

> AI-powered interview preparation platform with real-time copilot, mock interviews, resume optimization, and job tracking. **Your unfair advantage.**

## ✨ Features

| Module | Description |
|--------|-------------|
| **🎯 Live Copilot** | Real-time interview assistance with STT transcription, context-aware suggestions, STAR templates |
| **💻 Coding Copilot** | Hint ladder, complexity analysis, edge case detection |
| **📋 Mock Interviews** | Role-based sessions with scoring rubrics and actionable feedback |
| **📄 Resume Builder** | ATS parsing, JD matching, bullet rewriting with impact metrics |
| **📨 Job Hunter** | Job import, fit scoring, Kanban pipeline, follow-up reminders |
| **📊 Analytics** | Dashboard with funnel metrics, progress tracking, weak-area heatmap |

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ (20+ recommended)
- npm or yarn
- [Supabase CLI](https://github.com/supabase/cli) (for local development)
- A Supabase project (cloud or local)

### 1. Clone & Install

```bash
git clone https://github.com/your-org/apex-round.git
cd apex-round
npm install
```

### 2. Environment Setup

Copy the example environment file and configure:

```bash
cp .env.example .env.local
```

#### Required Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-only) | ✅ |
| `LLM_PROVIDER` | LLM provider (`openai`) | ✅ |
| `OPENAI_API_KEY` | OpenAI API key | ✅ |
| `STRIPE_SECRET_KEY` | Stripe secret key | ❌ |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret | ❌ |
| `NEXT_PUBLIC_DEEPGRAM_API_KEY` | Deepgram STT key | ❌ |

### 3. Database Setup

#### Option A: Push migrations directly

```bash
# Install Supabase CLI first
npm install -g supabase

# Link to your project
supabase link --project-ref YOUR_PROJECT_REF

# Push all migrations
supabase db push
```

#### Option B: Run SQL in Supabase Dashboard

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Open **SQL Editor**
3. Run every file in `supabase/migrations/` in filename order (`0001_init.sql` through `0022_integrations.sql`). Each version number is unique, so `supabase db push` applies the same order.

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

`npm run dev` starts a custom Node server (`server.ts`) that runs Next.js and the live speech-to-text relay on one port. Use `npm run dev:next` for plain Next.js without live transcription.

---

## 📁 Project Structure

```
apex-round/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/               # API routes
│   │   │   ├── copilot/       # Copilot sessions
│   │   │   ├── interviews/    # Interview CRUD
│   │   │   ├── resume/        # Resume operations
│   │   │   ├── llm/           # LLM proxy
│   │   │   ├── settings/      # User settings
│   │   │   └── ...
│   │   └── (page routes)
│   └── lib/                    # Shared utilities
│       ├── supabase/          # Supabase clients
│       ├── stt/               # Live speech-to-text
│       └── ...
├── supabase/
│   └── migrations/            # Database migrations
├── docs/                      # Documentation
├── public/                    # Static assets
└── tests/                     # Test files
```

---

## 🔌 API Reference

Every route, its methods and what it does are listed in [docs/API.md](docs/API.md). That file is generated from the route files (`node scripts/gen-api-docs.mjs`), so it matches the code.

## 🗄️ Database Schema

### Core Tables

- **`profiles`** — User profiles with subscription tier
- **`llm_settings`** — User LLM preferences
- **`interview_sessions`** — Interview session records
- **`interview_session_messages`** — Messages in interviews
- **`interview_session_feedback`** — Session feedback/scores
- **`resume_documents`** — User resumes
- **`resume_generations`** — AI-generated content history
- **`jobs`** — Job listings
- **`copilot_sessions`** — Live copilot sessions
- **`copilot_events`** — Session events/transcripts
- **`copilot_suggestions`** — AI suggestions during sessions
- **`subscriptions`** — Stripe subscriptions

### Storage Buckets

- **`resumes`** — Uploaded resume files

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run specific test file
npm test -- rateLimit.test.ts
```

---

## Deploy

Apex Round needs a Node host with WebSocket support (a custom server relays live transcription), so it cannot run on Vercel. A production `Dockerfile` is included. Step-by-step setup for Supabase, Stripe, cron jobs, Render / Fly.io / Railway and the desktop app is in [docs/deploy.md](docs/deploy.md).

---

## 🚢 Deployment

### Node host (required for live transcription)

Live transcription streams audio through a WebSocket relay in the custom server (`server.ts`), so deploy to a host that runs a long-lived Node process (Render, Fly.io, Railway, a VPS or Docker). Vercel doesn't run custom servers.

```bash
npm ci
npm run build   # Next.js build + compiles server.ts into .server/
npm start       # serves on $PORT (default 3000)
```

Also set `DEEPGRAM_API_KEY` (ideally a member-role key in a dedicated Deepgram project with a spending cap).

### Environment Variables for Production

Ensure these are set in your deployment platform:

```
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
LLM_PROVIDER=openai
OPENAI_API_KEY=<your-openai-key>
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

---

## 🔒 Security

- All API routes require authentication
- Row-Level Security (RLS) enabled on all tables
- Service role key never exposed to client
- Input validation with Zod
- Basic rate limiting (in-memory, per-IP)

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style

- Use ESLint for linting
- Follow TypeScript best practices
- Write tests for new features

---

## 📄 License

Private — All rights reserved.

---

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org)
- [Supabase](https://supabase.com)
- [OpenAI](https://openai.com)
- [Deepgram](https://deepgram.com)
