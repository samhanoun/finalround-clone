import { NextRequest, NextResponse } from 'next/server';
import { MANAGE_ROLES, requireAdmin } from '@/lib/adminAuth';
import { exportAuditLogs, AuditAction, AuditResourceType } from '@/lib/audit';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(MANAGE_ROLES);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id') || undefined;
    const organizationId = searchParams.get('organization_id') || undefined;
    const action = searchParams.get('action') as AuditAction | undefined;
    const resourceType = searchParams.get('resource_type') as AuditResourceType | undefined;
    const resourceId = searchParams.get('resource_id') || undefined;
    const startDate = searchParams.get('start_date') || undefined;
    const endDate = searchParams.get('end_date') || undefined;

    const { data: csvContent, filename } = await exportAuditLogs({
      organization_id: organizationId,
      user_id: userId,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      start_date: startDate,
      end_date: endDate
    });

    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Audit Export API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
