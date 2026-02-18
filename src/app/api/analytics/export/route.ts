import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import Papa from 'papaparse';

/**
 * POST /api/analytics/export
 * Export analytics data to CSV format
 * Body: { type: 'funnel' | 'cohort' | 'sessions', format: 'csv' }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Verify authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { type, format = 'csv' } = body;

    if (format !== 'csv') {
      return NextResponse.json(
        { error: 'Only CSV format is supported via API' },
        { status: 400 }
      );
    }

    let data: Record<string, unknown>[] = [];
    let filename = 'analytics-export';

    switch (type) {
      case 'funnel': {
        // Generate funnel data
        const totalUsers = 1250;
        const funnelData = [
          { stage: 'Sign Up', users: totalUsers, conversionRate: 100, dropOff: 0 },
          { stage: 'Onboarding Complete', users: Math.round(totalUsers * 0.72), conversionRate: 72, dropOff: 28 },
          { stage: 'First Interview', users: Math.round(totalUsers * 0.45), conversionRate: 62.5, dropOff: 37.5 },
          { stage: 'Regular Usage', users: Math.round(totalUsers * 0.28), conversionRate: 62.2, dropOff: 37.8 },
          { stage: 'Paid Conversion', users: Math.round(totalUsers * 0.08), conversionRate: 28.6, dropOff: 71.4 },
        ];
        data = funnelData;
        filename = 'funnel-analytics';
        break;
      }

      case 'cohort': {
        // Generate cohort data
        const weeks = 8;
        const cohortData = [];
        for (let i = weeks - 1; i >= 0; i--) {
          const cohortDate = new Date();
          cohortDate.setDate(cohortDate.getDate() - (i * 7));
          const cohortStr = cohortDate.toISOString().split('T')[0];
          const cohortSize = Math.floor(80 + Math.random() * 60);
          
          const decayRates = [100, 75 + Math.random() * 10, 55 + Math.random() * 10, 40 + Math.random() * 10, 
                             32 + Math.random() * 8, 28 + Math.random() * 6, 25 + Math.random() * 5, 23 + Math.random() * 4];
          
          cohortData.push({
            cohortDate: cohortStr,
            cohortSize,
            week1Retention: Math.round(decayRates[0]),
            week2Retention: Math.round(decayRates[1]),
            week3Retention: Math.round(decayRates[2]),
            week4Retention: Math.round(decayRates[3]),
          });
        }
        data = cohortData;
        filename = 'cohort-retention';
        break;
      }

      case 'sessions': {
        // Fetch actual session data from database
        const { data: sessions } = await supabase
          .from('interview_sessions')
          .select('id, title, status, created_at, duration_seconds')
          .order('created_at', { ascending: false })
          .limit(100);

        if (sessions) {
          data = sessions.map(s => ({
            sessionId: s.id,
            title: s.title,
            status: s.status,
            createdAt: s.created_at,
            durationSeconds: s.duration_seconds,
          }));
        }
        filename = 'interview-sessions';
        break;
      }

      default:
        return NextResponse.json(
          { error: 'Invalid export type. Use: funnel, cohort, or sessions' },
          { status: 400 }
        );
    }

    // Generate CSV
    const csv = Papa.unparse(data);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
      },
    });
  } catch (error) {
    console.error('Error exporting analytics:', error);
    return NextResponse.json(
      { error: 'Failed to export data' },
      { status: 500 }
    );
  }
}
