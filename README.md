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
3. Run migrations in order from `supabase/migrations/`:
   - `0001_init.sql`
   - `0002_mvp_spec.sql`
   - `0003_pro_plan_quotas.sql`
   - `0004_stripe_billing.sql`
   - `0005_subscription_sync.sql`
   - `0006_storage_resumes_policies.sql`
   - `0007_copilot_foundation.sql`
   - `0008_free_plan_limits.sql`
   - `0008_interview_questions_reports.sql`

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

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
│       ├── sttProviders/      # Speech-to-text
│       └── ...
├── supabase/
│   └── migrations/            # Database migrations
├── docs/                      # Documentation
├── public/                    # Static assets
└── tests/                     # Test files
```

---

## 🔌 API Reference

### Authentication

All API routes require authentication via Supabase session cookies. The client uses `@supabase/ssr` for authentication.

### Interview Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/interviews` | List user's interviews |
| `POST` | `/api/interviews` | Create new interview |
| `GET` | `/api/interviews/[id]` | Get interview details |
| `DELETE` | `/api/interviews/[id]` | Delete interview |
| `POST` | `/api/interviews/[id]/messages` | Add message to interview |
| `POST` | `/api/interviews/[id]/score` | Score an interview |
| `GET` | `/api/interviews/[id]/report` | Get interview report |
| `POST` | `/api/interviews/[id]/export` | Export interview data |
| `POST` | `/api/interviews/[id]/questions` | Get AI-generated questions |
| `POST` | `/api/interviews/[id]/difficulty` | Adjust difficulty |

### Copilot Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/copilot/sessions/start` | Start copilot session |
| `POST` | `/api/copilot/sessions/stop` | Stop copilot session |
| `GET` | `/api/copilot/sessions/[id]` | Get session details |
| `POST` | `/api/copilot/sessions/[id]/events` | Send events (transcript, actions) |
| `GET` | `/api/copilot/sessions/[id]/stream` | SSE stream for suggestions |
| `POST` | `/api/copilot/sessions/[id]/transcript` | Get full transcript |
| `POST` | `/api/copilot/sessions/[id]/summarize` | Get AI summary |
| `GET` | `/api/copilot/sessions/history` | Get session history |
| `DELETE` | `/api/copilot/sessions/purge` | Purge old sessions |

### Resume

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/resume` | List user's resumes |
| `POST` | `/api/resume` | Create resume entry |
| `POST` | `/api/resume/upload` | Upload resume file |
| `GET` | `/api/resume/[id]` | Get resume details |
| `PUT` | `/api/resume/[id]` | Update resume |
| `DELETE` | `/api/resume/[id]` | Delete resume |
| `POST` | `/api/resume/generate` | Generate resume content |
| `GET` | `/api/resume/history` | Get generation history |

### LLM

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/llm` | Proxy to LLM (OpenAI) |

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/settings/llm` | Get LLM settings |
| `PUT` | `/api/settings/llm` | Update LLM settings |

### Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/analytics/reconciliation` | Analytics data reconciliation |

### Webhooks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/webhooks/stripe` | Stripe webhook handler |

### Cron Jobs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/cron/retention` | Data retention cleanup |

---

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

## 🚢 Deployment

### Vercel (Recommended)

1. Push code to GitHub
2. Import project in Vercel
3. Configure environment variables
4. Deploy

```bash
# Or deploy via CLI
vercel deploy --prod
```

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
