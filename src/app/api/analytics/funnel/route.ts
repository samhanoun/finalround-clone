import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface FunnelStage {
  name: string;
  value: number;
  conversionRate: number;
  dropOff: number;
}

interface FunnelData {
  stages: FunnelStage[];
  period: { start: string; end: string };
  totalUsers: number;
}

/**
 * GET /api/analytics/funnel
 * Returns conversion funnel data for analytics dashboard
 */
export async function GET() {
  try {
    const supabase = await createClient();
    
    // Get date range (last 30 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    // For demo purposes, we'll generate realistic mock data
    // In production, this would query actual user events from the database
    
    // Simulated funnel stages based on typical SaaS conversion:
    // 1. Sign up -> 2. Onboarding complete -> 3. First interview -> 4. Regular usage -> 5. Paid conversion
    const totalUsers = 1250;
    
    const stages: FunnelStage[] = [
      { name: 'Sign Up', value: totalUsers, conversionRate: 100, dropOff: 0 },
      { name: 'Onboarding Complete', value: Math.round(totalUsers * 0.72), conversionRate: 72, dropOff: 28 },
      { name: 'First Interview', value: Math.round(totalUsers * 0.45), conversionRate: 62.5, dropOff: 37.5 },
      { name: 'Regular Usage', value: Math.round(totalUsers * 0.28), conversionRate: 62.2, dropOff: 37.8 },
      { name: 'Paid Conversion', value: Math.round(totalUsers * 0.08), conversionRate: 28.6, dropOff: 71.4 },
    ];

    // Calculate actual conversion rates from previous stage
    for (let i = 1; i < stages.length; i++) {
      const prevValue = stages[i - 1].value;
      const currValue = stages[i].value;
      stages[i].conversionRate = Math.round((currValue / prevValue) * 100 * 10) / 10;
      stages[i].dropOff = Math.round((1 - currValue / prevValue) * 100 * 10) / 10;
    }

    const funnelData: FunnelData = {
      stages,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      totalUsers,
    };

    return NextResponse.json(funnelData);
  } catch (error) {
    console.error('Error fetching funnel data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch funnel data' },
      { status: 500 }
    );
  }
}
