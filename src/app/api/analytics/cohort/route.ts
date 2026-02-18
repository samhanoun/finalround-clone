import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface CohortData {
  cohortDate: string;
  cohortSize: number;
  retention: number[];
}

interface CohortAnalysisData {
  cohorts: CohortData[];
  averageRetention: number[];
  period: { start: string; end: string };
}

/**
 * GET /api/analytics/cohort
 * Returns cohort retention analysis data
 */
export async function GET() {
  try {
    const supabase = await createClient();
    
    // Generate sample cohort data for the last 8 weeks
    const weeks = 8;
    const cohorts: CohortData[] = [];
    
    // Generate cohort data going back 8 weeks
    for (let i = weeks - 1; i >= 0; i--) {
      const cohortDate = new Date();
      cohortDate.setDate(cohortDate.getDate() - (i * 7));
      const cohortStr = cohortDate.toISOString().split('T')[0];
      
      // Simulated cohort sizes (random but realistic)
      const cohortSize = Math.floor(80 + Math.random() * 60);
      
      // Simulated retention rates (typically decay over time)
      // Week 0 is always 100%, then decays
      const baseRetention = 100;
      const decayRates = [100, 75 + Math.random() * 10, 55 + Math.random() * 10, 40 + Math.random() * 10, 
                         32 + Math.random() * 8, 28 + Math.random() * 6, 25 + Math.random() * 5, 23 + Math.random() * 4];
      
      const weeksActive = Math.min(weeks - i, weeks);
      const retention = decayRates.slice(0, weeksActive).map(r => Math.round(r * 10) / 10);
      
      cohorts.push({
        cohortDate: cohortStr,
        cohortSize,
        retention,
      });
    }

    // Calculate average retention across all cohorts for each week
    const averageRetention: number[] = [];
    for (let week = 0; week < weeks; week++) {
      const weekRetentions = cohorts
        .filter(c => c.retention.length > week)
        .map(c => c.retention[week]);
      
      if (weekRetentions.length > 0) {
        const avg = weekRetentions.reduce((a, b) => a + b, 0) / weekRetentions.length;
        averageRetention.push(Math.round(avg * 10) / 10);
      } else {
        averageRetention.push(0);
      }
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (weeks * 7));

    const cohortData: CohortAnalysisData = {
      cohorts,
      averageRetention,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    };

    return NextResponse.json(cohortData);
  } catch (error) {
    console.error('Error fetching cohort data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch cohort data' },
      { status: 500 }
    );
  }
}
