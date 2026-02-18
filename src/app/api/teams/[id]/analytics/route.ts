import { NextRequest, NextResponse } from 'next/server';
import { 
  getServerOrganizationClient, 
  getOrganizationAnalytics,
  getTeamStats,
  checkOrganizationAccess 
} from '@/lib/organizations';

// GET /api/teams/[id]/analytics - Get team analytics
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = getServerOrganizationClient();

    const hasAccess = await checkOrganizationAccess(supabase, id, ['owner', 'admin', 'member']);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '30d';
    
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    switch (period) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '12m':
        startDate.setMonth(startDate.getMonth() - 12);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }

    const [analytics, stats] = await Promise.all([
      getOrganizationAnalytics(
        supabase, 
        id, 
        startDate.toISOString().split('T')[0], 
        endDate.toISOString().split('T')[0]
      ),
      getTeamStats(supabase, id),
    ]);

    return NextResponse.json({
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      stats,
      analytics,
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 });
  }
}
