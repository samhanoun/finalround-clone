import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { queryAuditLogs, AuditAction, AuditResourceType } from '@/lib/audit';

export async function GET(request: NextRequest) {
  try {
    const supabase = createAdminClient();
    
    // Check if user is admin
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: adminUser } = await supabase
      .from('admin_users')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (!adminUser) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const userId = searchParams.get('user_id') || undefined;
    const organizationId = searchParams.get('organization_id') || undefined;
    const action = searchParams.get('action') as AuditAction | undefined;
    const resourceType = searchParams.get('resource_type') as AuditResourceType | undefined;
    const resourceId = searchParams.get('resource_id') || undefined;
    const startDate = searchParams.get('start_date') || undefined;
    const endDate = searchParams.get('end_date') || undefined;

    const result = await queryAuditLogs({
      organization_id: organizationId,
      user_id: userId,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      start_date: startDate,
      end_date: endDate,
      limit,
      offset
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Audit API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
