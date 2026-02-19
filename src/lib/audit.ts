/**
 * Audit Logging Library
 * 
 * Provides comprehensive audit trail for all data modifications:
 * - Who: user_id, actor details
 * - What: action, resource_type, resource_id, changes
 * - When: timestamp
 * 
 * PRD: SEC-040 Audit logs, consent records, and access reviews
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { cookies } from 'next/headers';

export type AuditAction = 
  // Auth actions
  | 'user.login'
  | 'user.logout'
  | 'user.signup'
  | 'user.password_change'
  | 'user.session_refresh'
  
  // Data CRUD
  | 'data.create'
  | 'data.read'
  | 'data.update'
  | 'data.delete'
  
  // Resource-specific
  | 'interview.create'
  | 'interview.update'
  | 'interview.delete'
  | 'interview.start'
  | 'interview.end'
  | 'interview.export'
  
  | 'resume.upload'
  | 'resume.parse'
  | 'resume.rewrite'
  | 'resume.delete'
  
  | 'job.create'
  | 'job.update'
  | 'job.delete'
  | 'job.import'
  
  | 'application.create'
  | 'application.update'
  | 'application.delete'
  | 'application.stage_change'
  
  | 'copilot.session_start'
  | 'copilot.session_end'
  | 'copilot.suggestion_view'
  | 'copilot.consent_grant'
  | 'copilot.consent_revoke'
  
  | 'cover_letter.create'
  | 'cover_letter.update'
  | 'cover_letter.export'
  
  | 'admin.user_update'
  | 'admin.user_delete'
  | 'admin.role_change'
  | 'admin.feature_flag_change'
  | 'admin.settings_change'
  
  // Compliance
  | 'consent.grant'
  | 'consent.revoke'
  | 'data.export'
  | 'data.delete_request'
  | 'data.access_request';

export type AuditResourceType = 
  | 'user'
  | 'profile'
  | 'interview'
  | 'interview_session'
  | 'copilot_session'
  | 'resume'
  | 'job'
  | 'job_application'
  | 'cover_letter'
  | 'subscription'
  | 'settings'
  | 'organization'
  | 'team'
  | 'badge'
  | 'notification'
  | 'consent'
  | 'audit_log'
  | 'admin';

export interface AuditLogEntry {
  id?: string;
  organization_id?: string;
  user_id?: string;
  actor_id?: string;
  actor_email?: string;
  action: AuditAction;
  resource_type: AuditResourceType;
  resource_id?: string;
  details?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  created_at?: string;
}

export interface AuditLogFilter {
  organization_id?: string;
  user_id?: string;
  actor_id?: string;
  action?: AuditAction | AuditAction[];
  resource_type?: AuditResourceType | AuditResourceType[];
  resource_id?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

/**
 * Log an audit event to the database
 */
export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  const supabase = createAdminClient();
  
  const { error } = await supabase
    .from('audit_logs')
    .insert({
      organization_id: entry.organization_id,
      user_id: entry.user_id,
      actor_id: entry.actor_id,
      actor_email: entry.actor_email,
      action: entry.action,
      resource_type: entry.resource_type,
      resource_id: entry.resource_id,
      details: entry.details || {},
      ip_address: entry.ip_address,
      user_agent: entry.user_agent,
    });

  if (error) {
    console.error('Failed to log audit event:', error);
    // Don't throw - audit logging should not break the main flow
  }
}

/**
 * Log an audit event with automatic actor detection from the request
 */
export async function logAuditWithRequest(
  entry: Omit<AuditLogEntry, 'actor_id' | 'actor_email' | 'ip_address' | 'user_agent'>,
  request?: Request
): Promise<void> {
  let actorId: string | undefined;
  let actorEmail: string | undefined;
  
  // Try to get user from cookies (Next.js App Router)
  try {
    const cookieStore = await cookies();
    const supabase = createAdminClient();
    
    // Get user from Supabase auth
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      actorId = user.id;
      actorEmail = user.email;
    }
  } catch {
    // Cookies might not be available in all contexts
  }

  const ipAddress = request?.headers.get('x-forwarded-for') || 
                    request?.headers.get('x-real-ip') || 
                    undefined;
  
  const userAgent = request?.headers.get('user-agent') || undefined;

  await logAuditEvent({
    ...entry,
    actor_id: actorId,
    actor_email: actorEmail,
    ip_address: ipAddress,
    user_agent: userAgent,
  });
}

/**
 * Query audit logs with filtering
 */
export async function queryAuditLogs(
  filter: AuditLogFilter
): Promise<{ data: AuditLogEntry[]; total: number }> {
  const supabase = createAdminClient();
  
  let query = supabase
    .from('audit_logs')
    .select('*', { count: 'exact' });

  if (filter.organization_id) {
    query = query.eq('organization_id', filter.organization_id);
  }
  
  if (filter.user_id) {
    query = query.eq('user_id', filter.user_id);
  }
  
  if (filter.actor_id) {
    query = query.eq('actor_id', filter.actor_id);
  }
  
  if (filter.action) {
    if (Array.isArray(filter.action)) {
      query = query.in('action', filter.action);
    } else {
      query = query.eq('action', filter.action);
    }
  }
  
  if (filter.resource_type) {
    if (Array.isArray(filter.resource_type)) {
      query = query.in('resource_type', filter.resource_type);
    } else {
      query = query.eq('resource_type', filter.resource_type);
    }
  }
  
  if (filter.resource_id) {
    query = query.eq('resource_id', filter.resource_id);
  }
  
  if (filter.start_date) {
    query = query.gte('created_at', filter.start_date);
  }
  
  if (filter.end_date) {
    query = query.lte('created_at', filter.end_date);
  }

  // Get total count
  const { count } = await query;
  
  // Apply pagination
  query = query
    .order('created_at', { ascending: false })
    .range(filter.offset || 0, (filter.offset || 0) + (filter.limit || 50) - 1);

  const { data, error } = await query;

  if (error) {
    console.error('Failed to query audit logs:', error);
    throw error;
  }

  return {
    data: data || [],
    total: count || 0
  };
}

/**
 * Get audit logs for a specific user (for their own activity view)
 */
export async function getUserAuditTrail(
  userId: string,
  options?: { limit?: number; offset?: number }
): Promise<{ data: AuditLogEntry[]; total: number }> {
  return queryAuditLogs({
    user_id: userId,
    limit: options?.limit || 50,
    offset: options?.offset || 0,
  });
}

/**
 * Get all audit logs for an organization (admin view)
 */
export async function getOrganizationAuditTrail(
  organizationId: string,
  options?: { 
    limit?: number; 
    offset?: number;
    action?: AuditAction[];
    resource_type?: AuditResourceType[];
    start_date?: string;
    end_date?: string;
  }
): Promise<{ data: AuditLogEntry[]; total: number }> {
  return queryAuditLogs({
    organization_id: organizationId,
    limit: options?.limit || 50,
    offset: options?.offset || 0,
    action: options?.action,
    resource_type: options?.resource_type,
    start_date: options?.start_date,
    end_date: options?.end_date,
  });
}

/**
 * Export audit logs for compliance (CSV format)
 */
export async function exportAuditLogs(
  filter: AuditLogFilter
): Promise<{ data: string; filename: string }> {
  const { data, total } = await queryAuditLogs({
    ...filter,
    limit: 10000, // Maximum for export
    offset: 0,
  });

  // Generate CSV
  const headers = [
    'ID',
    'Timestamp',
    'Organization ID',
    'Actor ID',
    'Actor Email',
    'User ID',
    'Action',
    'Resource Type',
    'Resource ID',
    'IP Address',
    'User Agent',
    'Details'
  ];

  const rows = data.map(entry => [
    entry.id || '',
    entry.created_at || '',
    entry.organization_id || '',
    entry.actor_id || '',
    entry.actor_email || '',
    entry.user_id || '',
    entry.action || '',
    entry.resource_type || '',
    entry.resource_id || '',
    entry.ip_address || '',
    (entry.user_agent || '').substring(0, 200), // Truncate long user agents
    JSON.stringify(entry.details || {})
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  const date = new Date().toISOString().split('T')[0];
  return {
    data: csvContent,
    filename: `audit-logs-${date}-${total}records.csv`
  };
}

/**
 * Get audit log summary for dashboard
 */
export async function getAuditLogSummary(
  organizationId?: string,
  days: number = 30
): Promise<{
  total_events: number;
  events_by_action: Record<string, number>;
  events_by_resource: Record<string, number>;
  events_by_day: Record<string, number>;
  unique_users: number;
}> {
  const supabase = createAdminClient();
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  let query = supabase
    .from('audit_logs')
    .select('action, resource_type, created_at, actor_id')
    .gte('created_at', startDate.toISOString());

  if (organizationId) {
    query = query.eq('organization_id', organizationId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Failed to get audit log summary:', error);
    throw error;
  }

  const eventsByAction: Record<string, number> = {};
  const eventsByResource: Record<string, number> = {};
  const eventsByDay: Record<string, number> = {};
  const uniqueUsers = new Set<string>();

  for (const entry of data || []) {
    eventsByAction[entry.action] = (eventsByAction[entry.action] || 0) + 1;
    eventsByResource[entry.resource_type] = (eventsByResource[entry.resource_type] || 0) + 1;
    
    const day = entry.created_at?.split('T')[0] || 'unknown';
    eventsByDay[day] = (eventsByDay[day] || 0) + 1;
    
    if (entry.actor_id) {
      uniqueUsers.add(entry.actor_id);
    }
  }

  return {
    total_events: data?.length || 0,
    events_by_action: eventsByAction,
    events_by_resource: eventsByResource,
    events_by_day: eventsByDay,
    unique_users: uniqueUsers.size
  };
}
