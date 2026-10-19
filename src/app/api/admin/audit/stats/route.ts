import { NextRequest, NextResponse } from 'next/server';
import { MANAGE_ROLES, requireAdmin } from '@/lib/adminAuth';
import { getAuditLogSummary } from '@/lib/audit';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(MANAGE_ROLES);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get('organization_id') || undefined;
    const days = parseInt(searchParams.get('days') || '30');

    const stats = await getAuditLogSummary(organizationId, days);

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Audit Stats API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
