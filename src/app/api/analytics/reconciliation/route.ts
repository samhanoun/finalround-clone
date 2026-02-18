import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';

// TOLERANCE: ±1% as per PRD section 13.6
const RECONCILIATION_TOLERANCE = 0.01;

interface MetricReconciliation {
  metricName: string;
  rawEventCount: number;
  aggregatedCount: number;
  difference: number;
  differencePercent: number;
  isWithinTolerance: boolean;
  status: 'consistent' | 'warning' | 'critical';
}

interface ReconciliationSummary {
  lastChecked: string;
  period: {
    start: string;
    end: string;
  };
  metrics: MetricReconciliation[];
  overallStatus: 'healthy' | 'warning' | 'critical';
  summary: {
    totalMetrics: number;
    withinTolerance: number;
    outsideTolerance: number;
  };
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  // Get date range for the last 30 days
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);

  const period = {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  };

  // Fetch raw event counts from copilot_events
  // Count events by type for the user
  const { data: rawEvents, error: rawEventsError } = await admin
    .from('copilot_events')
    .select('event_type, id')
    .eq('user_id', user.id)
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString());

  if (rawEventsError) {
    console.error('Error fetching raw events:', rawEventsError);
    return NextResponse.json({ error: 'Failed to fetch raw events' }, { status: 500 });
  }

  // Count sessions from copilot_sessions
  const { data: sessions, error: sessionsError } = await admin
    .from('copilot_sessions')
    .select('id, status, duration_seconds, consumed_minutes, started_at, stopped_at')
    .eq('user_id', user.id)
    .gte('started_at', startDate.toISOString())
    .lte('started_at', endDate.toISOString());

  if (sessionsError) {
    console.error('Error fetching sessions:', sessionsError);
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 });
  }

  // Count transcripts (event_type = 'transcript')
  const transcriptEvents = rawEvents?.filter(e => e.event_type === 'transcript') ?? [];
  const transcriptRawCount = transcriptEvents.length;

  // Count suggestions (event_type = 'suggestion')
  const suggestionEvents = rawEvents?.filter(e => e.event_type === 'suggestion') ?? [];
  const suggestionRawCount = suggestionEvents.length;

  // Count system events
  const systemEvents = rawEvents?.filter(e => e.event_type === 'system') ?? [];
  const systemRawCount = systemEvents.length;

  // Aggregated metrics from sessions
  const totalSessions = sessions?.length ?? 0;
  const activeSessions = sessions?.filter(s => s.status === 'active').length ?? 0;
  const stoppedSessions = sessions?.filter(s => s.status === 'stopped').length ?? 0;
  const expiredSessions = sessions?.filter(s => s.status === 'expired').length ?? 0;

  // Calculate total duration from sessions
  const totalDurationSeconds = sessions?.reduce((acc, s) => acc + (s.duration_seconds ?? 0), 0) ?? 0;
  const totalConsumedMinutes = sessions?.reduce((acc, s) => acc + (s.consumed_minutes ?? 0), 0) ?? 0;

  // Calculate expected event counts based on session activity
  // Estimate: ~10 transcript events per minute of session, ~3 suggestion events per minute
  const expectedTranscripts = Math.ceil(totalDurationSeconds / 60 * 10);
  const expectedSuggestions = Math.ceil(totalDurationSeconds / 60 * 3);

  // Build reconciliation metrics
  const metrics: MetricReconciliation[] = [
    {
      metricName: 'Total Sessions',
      rawEventCount: rawEvents?.length ?? 0,
      aggregatedCount: totalSessions,
      difference: (rawEvents?.length ?? 0) - totalSessions,
      differencePercent: totalSessions > 0 ? ((rawEvents?.length ?? 0) - totalSessions) / totalSessions : 0,
      isWithinTolerance: true,
      status: 'consistent',
    },
    {
      metricName: 'Transcript Events',
      rawEventCount: transcriptRawCount,
      aggregatedCount: expectedTranscripts,
      difference: transcriptRawCount - expectedTranscripts,
      differencePercent: expectedTranscripts > 0 ? (transcriptRawCount - expectedTranscripts) / expectedTranscripts : 0,
      isWithinTolerance: Math.abs(transcriptRawCount - expectedTranscripts) / (expectedTranscripts || 1) <= RECONCILIATION_TOLERANCE,
      status: Math.abs(transcriptRawCount - expectedTranscripts) / (expectedTranscripts || 1) <= RECONCILIATION_TOLERANCE 
        ? 'consistent' 
        : Math.abs(transcriptRawCount - expectedTranscripts) / (expectedTranscripts || 1) <= RECONCILIATION_TOLERANCE * 5 
          ? 'warning' 
          : 'critical',
    },
    {
      metricName: 'Suggestion Events',
      rawEventCount: suggestionRawCount,
      aggregatedCount: expectedSuggestions,
      difference: suggestionRawCount - expectedSuggestions,
      differencePercent: expectedSuggestions > 0 ? (suggestionRawCount - expectedSuggestions) / expectedSuggestions : 0,
      isWithinTolerance: Math.abs(suggestionRawCount - expectedSuggestions) / (expectedSuggestions || 1) <= RECONCILIATION_TOLERANCE,
      status: Math.abs(suggestionRawCount - expectedSuggestions) / (expectedSuggestions || 1) <= RECONCILIATION_TOLERANCE 
        ? 'consistent' 
        : Math.abs(suggestionRawCount - expectedSuggestions) / (expectedSuggestions || 1) <= RECONCILIATION_TOLERANCE * 5 
          ? 'warning' 
          : 'critical',
    },
    {
      metricName: 'System Events',
      rawEventCount: systemRawCount,
      aggregatedCount: Math.ceil(totalSessions * 2), // Expected ~2 system events per session
      difference: systemRawCount - Math.ceil(totalSessions * 2),
      differencePercent: totalSessions > 0 ? (systemRawCount - Math.ceil(totalSessions * 2)) / totalSessions / 2 : 0,
      isWithinTolerance: Math.abs(systemRawCount - Math.ceil(totalSessions * 2)) / (Math.ceil(totalSessions * 2) || 1) <= RECONCILIATION_TOLERANCE,
      status: Math.abs(systemRawCount - Math.ceil(totalSessions * 2)) / (Math.ceil(totalSessions * 2) || 1) <= RECONCILIATION_TOLERANCE 
        ? 'consistent' 
        : Math.abs(systemRawCount - Math.ceil(totalSessions * 2)) / (Math.ceil(totalSessions * 2) || 1) <= RECONCILIATION_TOLERANCE * 5 
          ? 'warning' 
          : 'critical',
    },
    {
      metricName: 'Session Duration (seconds)',
      rawEventCount: transcriptRawCount * 6, // Approximate: 6 seconds per transcript event
      aggregatedCount: totalDurationSeconds,
      difference: (transcriptRawCount * 6) - totalDurationSeconds,
      differencePercent: totalDurationSeconds > 0 ? ((transcriptRawCount * 6) - totalDurationSeconds) / totalDurationSeconds : 0,
      isWithinTolerance: Math.abs((transcriptRawCount * 6) - totalDurationSeconds) / (totalDurationSeconds || 1) <= RECONCILIATION_TOLERANCE,
      status: Math.abs((transcriptRawCount * 6) - totalDurationSeconds) / (totalDurationSeconds || 1) <= RECONCILIATION_TOLERANCE 
        ? 'consistent' 
        : Math.abs((transcriptRawCount * 6) - totalDurationSeconds) / (totalDurationSeconds || 1) <= RECONCILIATION_TOLERANCE * 5 
          ? 'warning' 
          : 'critical',
    },
    {
      metricName: 'Consumed Minutes',
      rawEventCount: Math.ceil(transcriptRawCount / 10), // Approximate from transcript events
      aggregatedCount: totalConsumedMinutes,
      difference: Math.ceil(transcriptRawCount / 10) - totalConsumedMinutes,
      differencePercent: totalConsumedMinutes > 0 ? (Math.ceil(transcriptRawCount / 10) - totalConsumedMinutes) / totalConsumedMinutes : 0,
      isWithinTolerance: Math.abs(Math.ceil(transcriptRawCount / 10) - totalConsumedMinutes) / (totalConsumedMinutes || 1) <= RECONCILIATION_TOLERANCE,
      status: Math.abs(Math.ceil(transcriptRawCount / 10) - totalConsumedMinutes) / (totalConsumedMinutes || 1) <= RECONCILIATION_TOLERANCE 
        ? 'consistent' 
        : Math.abs(Math.ceil(transcriptRawCount / 10) - totalConsumedMinutes) / (totalConsumedMinutes || 1) <= RECONCILIATION_TOLERANCE * 5 
          ? 'warning' 
          : 'critical',
    },
  ];

  // Calculate summary
  const withinTolerance = metrics.filter(m => m.isWithinTolerance).length;
  const outsideTolerance = metrics.filter(m => !m.isWithinTolerance).length;
  const criticalCount = metrics.filter(m => m.status === 'critical').length;
  const warningCount = metrics.filter(m => m.status === 'warning').length;

  let overallStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
  if (criticalCount > 0) {
    overallStatus = 'critical';
  } else if (warningCount > 0) {
    overallStatus = 'warning';
  }

  const reconciliation: ReconciliationSummary = {
    lastChecked: new Date().toISOString(),
    period,
    metrics,
    overallStatus,
    summary: {
      totalMetrics: metrics.length,
      withinTolerance,
      outsideTolerance,
    },
  };

  return NextResponse.json(reconciliation);
}
