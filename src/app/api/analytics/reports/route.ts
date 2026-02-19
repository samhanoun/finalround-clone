import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

interface ScheduledReport {
  id: string;
  user_id: string;
  report_type: 'funnel' | 'cohort' | 'sessions' | 'full';
  frequency: 'daily' | 'weekly' | 'monthly';
  email: string;
  enabled: boolean;
  last_sent: string | null;
  next_send: string;
  created_at: string;
}

/**
 * GET /api/analytics/reports
 * Get scheduled reports for the current user
 */
export async function GET() {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // In production, this would fetch from a scheduled_reports table
    // For now, return mock data
    const reports: ScheduledReport[] = [
      {
        id: '1',
        user_id: user.id,
        report_type: 'full',
        frequency: 'weekly',
        email: user.email || '',
        enabled: true,
        last_sent: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        next_send: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ];

    return NextResponse.json({ reports });
  } catch (error) {
    console.error('Error fetching reports:', error);
    return NextResponse.json(
      { error: 'Failed to fetch reports' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/analytics/reports
 * Create a new scheduled report
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { report_type, frequency, email } = body;

    if (!report_type || !frequency || !email) {
      return NextResponse.json(
        { error: 'Missing required fields: report_type, frequency, email' },
        { status: 400 }
      );
    }

    // Calculate next send date based on frequency
    const nextSend = new Date();
    switch (frequency) {
      case 'daily':
        nextSend.setDate(nextSend.getDate() + 1);
        break;
      case 'weekly':
        nextSend.setDate(nextSend.getDate() + 7);
        break;
      case 'monthly':
        nextSend.setMonth(nextSend.getMonth() + 1);
        break;
    }

    // In production, this would insert into a scheduled_reports table
    const newReport: ScheduledReport = {
      id: Math.random().toString(36).substring(7),
      user_id: user.id,
      report_type,
      frequency,
      email,
      enabled: true,
      last_sent: null,
      next_send: nextSend.toISOString(),
      created_at: new Date().toISOString(),
    };

    return NextResponse.json({ report: newReport }, { status: 201 });
  } catch (error) {
    console.error('Error creating report:', error);
    return NextResponse.json(
      { error: 'Failed to create report' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/analytics/reports
 * Update a scheduled report (enable/disable, modify settings)
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { id, enabled, email, frequency } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Report ID is required' },
        { status: 400 }
      );
    }

    // In production, this would update the scheduled_reports table
    // For now, return success
    return NextResponse.json({ 
      success: true, 
      message: `Report ${id} updated` 
    });
  } catch (error) {
    console.error('Error updating report:', error);
    return NextResponse.json(
      { error: 'Failed to update report' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/analytics/reports
 * Delete a scheduled report
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Report ID is required' },
        { status: 400 }
      );
    }

    // In production, this would delete from the scheduled_reports table
    return NextResponse.json({ 
      success: true, 
      message: `Report ${id} deleted` 
    });
  } catch (error) {
    console.error('Error deleting report:', error);
    return NextResponse.json(
      { error: 'Failed to delete report' },
      { status: 500 }
    );
  }
}
