import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runCopilotRetentionSweep, buildCopilotRetentionCutoffs } from '@/lib/copilotRetention';
import { requireEnv } from '@/lib/env';
import { isCronAuthorized } from '@/lib/cronAuth';

/**
 * Retention Sweep Scheduler API Route
 * 
 * This endpoint implements the PRD-aligned retention sweep scheduler.
 * It can be triggered via cron job or called directly.
 * 
 * GET or POST /api/cron/retention?dryRun=true|false
 * Authorization: Bearer <CRON_SECRET>
 *
 * Query Parameters:
 * - dryRun: If "false", actually executes deletion. Defaults to true (safe dry-run mode).
 *
 * CRON SETUP: schedule it daily (for example 03:00 UTC) with the secret in the
 * Authorization header, never in the URL (URLs end up in access logs):
 *   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET"  *     "https://<your-domain>/api/cron/retention?dryRun=false"
 *
 * SECURITY:
 * - Requires CRON_SECRET env var to be set (minimum 32 characters)
 * - Requests without the right bearer token are rejected with 401 (constant-time comparison)
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

  if (!isCronAuthorized(request, [cronSecret])) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Send the cron secret as Authorization: Bearer <CRON_SECRET>' },
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
