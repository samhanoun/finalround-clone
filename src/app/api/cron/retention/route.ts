import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runCopilotRetentionSweep, buildCopilotRetentionCutoffs } from '@/lib/copilotRetention';
import { requireEnv } from '@/lib/env';

/**
 * Retention Sweep Scheduler API Route
 * 
 * This endpoint implements the PRD-aligned retention sweep scheduler.
 * It can be triggered via cron job or called directly.
 * 
 * GET /api/cron/retention?dryRun=true|false
 * 
 * Query Parameters:
 * - dryRun: If "false", actually executes deletion. Defaults to true (safe dry-run mode).
 * - cronKey: Required - must match CRON_SECRET env var for authentication
 * 
 * CRON SETUP:
 * - Vercel: Add to vercel.json:
 *   {
 *     "crons": [
 *       {
 *         "path": "/api/cron/retention?cronKey=YOUR_SECRET_KEY",
 *         "schedule": "0 3 * * *"
 *       }
 *     ]
 *   }
 * - External: Configure your cron service to hit this endpoint with ?cronKey=YOUR_SECRET_KEY
 * 
 * SECURITY:
 * - Requires CRON_SECRET env var to be set (minimum 32 characters)
 * - Requests without valid cronKey are rejected with 401
 * 
 * DRY-RUN EVIDENCE COLLECTION:
 * - Each execution logs the policy, cutoffs, and deletion counts
 * - For dry-run mode: returns 0 for all deleted counts
 * - For production: returns actual deletion counts
 * 
 * RETENTION POLICY (PRD-aligned):
 * - copilot_events: 30 days
 * - copilot_summaries: 90 days  
 * - copilot_sessions: 90 days (only stopped/expired status)
 */

export async function GET(request: Request) {
  // Check for CRON_SECRET - require authentication
  let cronSecret: string;
  try {
    cronSecret = requireEnv('CRON_SECRET');
  } catch {
    return NextResponse.json(
      { error: 'Cron endpoint not configured', message: 'CRON_SECRET environment variable not set' },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const providedKey = searchParams.get('cronKey');
  
  if (!providedKey || providedKey !== cronSecret) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Invalid or missing cronKey parameter' },
      { status: 401 }
    );
  }

  const dryRun = searchParams.get('dryRun') !== 'false';
  
  const now = new Date();
  
  // Build cutoffs for documentation/evidence
  const { policy, cutoffs } = buildCopilotRetentionCutoffs({ now });
  
  // Log the scheduled job execution
  console.log('[RetentionScheduler] Starting scheduled retention sweep', {
    timestamp: now.toISOString(),
    dryRun,
    policy,
    cutoffs,
  });

  try {
    const admin = createAdminClient();
    
    // Cast to any to match the RetentionAdminClient interface
    // The actual Supabase client has the required methods
    const result = await runCopilotRetentionSweep(admin as never, {
      now,
      dryRun,
    });

    // Document the evidence for this run
    const evidence = {
      executedAt: now.toISOString(),
      dryRun: result.dryRun,
      policy: result.policy,
      cutoffs: result.cutoffs,
      deleted: result.deleted,
      message: result.dryRun
        ? 'Dry-run completed. No data was deleted.'
        : `Retention sweep completed: ${result.deleted.events} events, ${result.deleted.summaries} summaries, ${result.deleted.sessions} sessions deleted.`,
    };

    console.log('[RetentionScheduler] Sweep result:', evidence);

    return NextResponse.json(evidence, {
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    console.error('[RetentionScheduler] Sweep failed:', {
      timestamp: now.toISOString(),
      error: errorMessage,
      dryRun,
    });

    return NextResponse.json(
      {
        executedAt: now.toISOString(),
        dryRun,
        error: errorMessage,
        message: 'Retention sweep failed',
      },
      { status: 500 }
    );
  }
}

// Also support POST for manual triggers
export async function POST(request: Request) {
  return GET(request);
}
