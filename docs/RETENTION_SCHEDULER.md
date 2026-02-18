# Copilot Retention Scheduler

This document describes the PRD-aligned retention sweep scheduler implementation.

## Overview

The retention scheduler automatically cleans up old copilot data to comply with data retention policies defined in the PRD.

## Retention Policy

| Data Type | Retention Period | Notes |
|-----------|------------------|-------|
| copilot_events | 30 days | All events |
| copilot_summaries | 90 days | Interview summaries |
| copilot_sessions | 90 days | Only stopped/expired sessions |

## API Endpoint

**Route:** `GET /api/cron/retention`

**Query Parameters:**
- `dryRun` (optional): Set to "false" to execute actual deletions. Defaults to "true" (safe mode).

**Response:**
```json
{
  "executedAt": "2026-02-18T12:00:00.000Z",
  "dryRun": true,
  "policy": {
    "eventsDays": 30,
    "summariesDays": 90,
    "sessionsDays": 90
  },
  "cutoffs": {
    "eventsBeforeIso": "2026-01-19T12:00:00.000Z",
    "summariesBeforeIso": "2025-11-20T12:00:00.000Z",
    "sessionsBeforeIso": "2025-11-20T12:00:00.000Z"
  },
  "deleted": {
    "events": 0,
    "summaries": 0,
    "sessions": 0
  },
  "message": "Dry-run completed. No data was deleted."
}
```

## Cron Setup

### Vercel (vercel.json)
```json
{
  "crons": [
    {
      "path": "/api/cron/retention",
      "schedule": "0 3 * * *"
    }
  ]
}
```

### External Cron Service
Configure your cron service to hit `https://your-domain.com/api/cron/retention` daily at 3 AM UTC.

### Example curl commands

**Dry-run (safe):**
```bash
curl "https://your-domain.com/api/cron/retention"
```

**Production execution:**
```bash
curl "https://your-domain.com/api/cron/retention?dryRun=false"
```

## Dry-Run Evidence Collection

Each execution collects and logs the following evidence:

1. **Timestamp**: When the sweep was executed
2. **Dry-run mode**: Whether this was a dry-run or actual deletion
3. **Policy**: The retention policy used (days for each data type)
4. **Cutoffs**: The ISO timestamps used as cutoff for each table
5. **Deleted counts**: Number of records deleted from each table

### Evidence Storage

Evidence is logged to:
- Server console (stdout)
- Response body for external consumption
- Can be extended to store in database or send to monitoring

### Safety Features

1. **Default dry-run**: The endpoint defaults to dry-run mode for safety
2. **Session status filter**: Only deletes sessions with status 'stopped' or 'expired'
3. **Atomic deletes**: Uses Promise.all for concurrent, atomic deletions
4. **Error handling**: Rolls back gracefully on errors

## Implementation

- **Route**: `src/app/api/cron/retention/route.ts`
- **Core logic**: `src/lib/copilotRetention.ts`
- **Admin client**: `src/lib/supabase/admin.ts`
- **Tests**: `src/lib/__tests__/copilotRetention.test.ts`
