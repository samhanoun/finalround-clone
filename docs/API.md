# API Documentation

## Overview

All API routes are located in `src/app/api/` and follow REST conventions. Routes require authentication via Supabase session cookies.

## Base URL

```
Production: https://your-domain.com
Development: http://localhost:3000
```

## Authentication

Most endpoints require authentication. The client authenticates using Supabase Auth and includes session cookies with requests.

### Client Setup

```typescript
import { createBrowserClient } from '@supabase/ssr';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// After login, session cookies are automatically included
const { data, error } = await supabase.from('profiles').select('*');
```

### Server-Side Auth

```typescript
import { createClient } from '@/lib/supabase/server';

const supabase = createClient();
const { data: { user } } = await supabase.auth.getUser();
```

---

## Interview Sessions API

### List Interviews

```
GET /api/interviews
```

Returns all interviews for the authenticated user.

**Response:**
```json
{
  "interviews": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "role": "Software Engineer",
      "type": "technical",
      "status": "completed",
      "created_at": "2026-02-16T00:00:00Z"
    }
  ]
}
```

### Create Interview

```
POST /api/interviews
```

**Request Body:**
```json
{
  "role": "Software Engineer",
  "type": "technical",
  "difficulty": "medium"
}
```

### Get Interview

```
GET /api/interviews/[id]
```

### Delete Interview

```
DELETE /api/interviews/[id]
```

### Add Message

```
POST /api/interviews/[id]/messages
```

**Request Body:**
```json
{
  "role": "assistant",
  "content": "Tell me about a time you solved a difficult problem."
}
```

### Score Interview

```
POST /api/interviews/[id]/score
```

**Request Body:**
```json
{
  "scores": {
    "technical": 85,
    "communication": 90,
    "problem_solving": 80
  },
  "feedback": "Great explanation of the system design."
}
```

### Get Report

```
GET /api/interviews/[id]/report
```

**Response:**
```json
{
  "overall_score": 85,
  "strengths": ["Clear communication", "Structured approach"],
  "weaknesses": ["Could elaborate on trade-offs"],
  "recommendations": ["Practice more system design questions"]
}
```

### Export Interview

```
POST /api/interviews/[id]/export
```

**Query Params:**
- `format` — `json` or `text`

### Generate Questions

```
POST /api/interviews/[id]/questions
```

**Request Body:**
```json
{
  "count": 5,
  "type": "behavioral"
}
```

### Adjust Difficulty

```
POST /api/interviews/[id]/difficulty
```

**Request Body:**
```json
{
  "difficulty": "hard"
}
```

---

## Copilot Sessions API

### Start Session

```
POST /api/copilot/sessions/start
```

**Request Body:**
```json
{
  "mode": "interview",
  "role": "Software Engineer",
  "company": "Google"
}
```

**Response:**
```json
{
  "session_id": "uuid",
  "stream_url": "/api/copilot/sessions/[id]/stream"
}
```

### Stop Session

```
POST /api/copilot/sessions/stop
```

**Request Body:**
```json
{
  "session_id": "uuid"
}
```

### Get Session

```
GET /api/copilot/sessions/[id]
```

### Send Events

```
POST /api/copilot/sessions/[id]/events
```

**Request Body:**
```json
{
  "type": "transcript",
  "content": "I would approach this by...",
  "timestamp": 1234567890
}
```

### Stream Suggestions (SSE)

```
GET /api/copilot/sessions/[id]/stream
```

Returns Server-Sent Events with AI suggestions.

### Get Transcript

```
POST /api/copilot/sessions/[id]/transcript
```

### Get Summary

```
POST /api/copilot/sessions/[id]/summarize
```

### Session History

```
GET /api/copilot/sessions/history
```

### Purge Old Sessions

```
DELETE /api/copilot/sessions/purge
```

---

## Resume API

### List Resumes

```
GET /api/resume
```

### Create Resume

```
POST /api/resume
```

**Request Body:**
```json
{
  "name": "Software Engineer Resume",
  "content": "..."
}
```

### Upload Resume

```
POST /api/resume/upload
```

**Content-Type:** `multipart/form-data`

**Form Data:**
- `file` — PDF or DOCX file
- `name` — Resume name

### Get Resume

```
GET /api/resume/[id]
```

### Update Resume

```
PUT /api/resume/[id]
```

### Delete Resume

```
DELETE /api/resume/[id]
```

### Generate Content

```
POST /api/resume/generate
```

**Request Body:**
```json
{
  "job_description": "Looking for a React developer...",
  "resume_id": "uuid",
  "type": "bullet_rewrite"
}
```

### Get History

```
GET /api/resume/history
```

---

## LLM API

### Proxy Request

```
POST /api/llm
```

Proxies requests to configured LLM (OpenAI).

**Request Body:**
```json
{
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "model": "gpt-4"
}
```

---

## Settings API

### Get LLM Settings

```
GET /api/settings/llm
```

**Response:**
```json
{
  "provider": "openai",
  "model": "gpt-4",
  "temperature": 0.7
}
```

### Update LLM Settings

```
PUT /api/settings/llm
```

**Request Body:**
```json
{
  "model": "gpt-4-turbo",
  "temperature": 0.5
}
```

---

## Analytics API

### Reconciliation

```
GET /api/analytics/reconciliation
```

Returns analytics data for dashboard.

---

## Webhooks API

### Stripe Webhook

```
POST /api/webhooks/stripe
```

Handles Stripe webhook events (subscription created, updated, cancelled, etc.).

**Headers:**
- `stripe-signature` — Stripe webhook signature

---

## Cron API

### Retention Cleanup

```
POST /api/cron/retention
```

Executes data retention policies (configurable in environment).

**Note:** Should be protected by cron secret or only accessible internally.

---

## Error Responses

All endpoints may return errors in the following format:

```json
{
  "error": "Error message",
  "details": {}
}
```

Common HTTP status codes:

| Code | Description |
|------|-------------|
| 400 | Bad Request — Invalid input |
| 401 | Unauthorized — Not authenticated |
| 403 | Forbidden — Not authorized |
| 404 | Not Found |
| 429 | Too Many Requests — Rate limited |
| 500 | Internal Server Error |

---

## Rate Limiting

Basic in-memory rate limiting is applied per IP:

- Default: 100 requests per minute
- `/api/llm`: 10 requests per minute
- `/api/copilot/*`: 30 requests per minute

---

## Input Validation

All inputs are validated using Zod schemas. Invalid requests return 400 with validation errors:

```json
{
  "error": "Validation failed",
  "details": [
    { "path": "email", "message": "Invalid email format" }
  ]
}
```
