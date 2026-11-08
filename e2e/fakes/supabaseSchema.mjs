// What the fake Supabase knows about the database, copied from
// supabase/migrations: foreign keys (embedded selects and ON DELETE), primary
// and unique keys (upserts and duplicate rows), column defaults and generated
// columns. When a migration changes one of these, change it here too.

import { randomUUID } from 'node:crypto';

/**
 * Every foreign key in the migrations: [table, column, parent, parent column, ON DELETE].
 * `auth.users` is the auth user (deleting one runs these rules too).
 */
const FK = [
  // 0001_init
  ['profiles', 'id', 'auth.users', 'id', 'cascade'],
  ['interviews', 'user_id', 'auth.users', 'id', 'cascade'],
  ['interview_messages', 'interview_id', 'interviews', 'id', 'cascade'],
  ['interview_messages', 'user_id', 'auth.users', 'id', 'cascade'],
  ['interview_scores', 'interview_id', 'interviews', 'id', 'cascade'],
  ['interview_scores', 'user_id', 'auth.users', 'id', 'cascade'],
  ['resume_assets', 'user_id', 'auth.users', 'id', 'cascade'],
  ['resume_runs', 'user_id', 'auth.users', 'id', 'cascade'],
  ['resume_runs', 'asset_id', 'resume_assets', 'id', 'set null'],
  ['jobs', 'user_id', 'auth.users', 'id', 'cascade'],
  // 0002_mvp_spec
  ['llm_settings', 'user_id', 'auth.users', 'id', 'cascade'],
  ['interview_sessions', 'user_id', 'auth.users', 'id', 'cascade'],
  ['interview_session_messages', 'session_id', 'interview_sessions', 'id', 'cascade'],
  ['interview_session_messages', 'user_id', 'auth.users', 'id', 'cascade'],
  ['interview_session_feedback', 'session_id', 'interview_sessions', 'id', 'cascade'],
  ['interview_session_feedback', 'user_id', 'auth.users', 'id', 'cascade'],
  ['resume_documents', 'user_id', 'auth.users', 'id', 'cascade'],
  ['resume_generations', 'user_id', 'auth.users', 'id', 'cascade'],
  ['resume_generations', 'document_id', 'resume_documents', 'id', 'set null'],
  // 0003_pro_plan_quotas
  ['subscriptions', 'user_id', 'auth.users', 'id', 'cascade'],
  ['subscriptions', 'plan_id', 'plans', 'id', 'no action'],
  ['usage_counters', 'user_id', 'auth.users', 'id', 'cascade'],
  // 0004_stripe_billing
  ['stripe_customers', 'user_id', 'auth.users', 'id', 'cascade'],
  ['stripe_subscriptions', 'user_id', 'auth.users', 'id', 'cascade'],
  ['stripe_subscriptions', 'stripe_customer_id', 'stripe_customers', 'stripe_customer_id', 'cascade'],
  // 0007_copilot_foundation
  ['copilot_sessions', 'user_id', 'auth.users', 'id', 'cascade'],
  ['copilot_sessions', 'interview_session_id', 'interview_sessions', 'id', 'set null'],
  ['copilot_events', 'session_id', 'copilot_sessions', 'id', 'cascade'],
  ['copilot_events', 'user_id', 'auth.users', 'id', 'cascade'],
  ['copilot_summaries', 'session_id', 'copilot_sessions', 'id', 'cascade'],
  ['copilot_summaries', 'user_id', 'auth.users', 'id', 'cascade'],
  // 0009_interview_questions_reports
  ['interview_questions', 'session_id', 'interview_sessions', 'id', 'cascade'],
  ['interview_questions', 'user_id', 'auth.users', 'id', 'cascade'],
  ['interview_reports', 'session_id', 'interview_sessions', 'id', 'cascade'],
  ['interview_reports', 'user_id', 'auth.users', 'id', 'cascade'],
  // 0010_cover_letters
  ['job_postings', 'user_id', 'auth.users', 'id', 'cascade'],
  ['cover_letters', 'user_id', 'auth.users', 'id', 'cascade'],
  ['cover_letters', 'job_id', 'job_postings', 'id', 'set null'],
  ['cover_letters', 'resume_id', 'resume_assets', 'id', 'set null'],
  // 0011_job_hunter
  ['job_applications', 'user_id', 'auth.users', 'id', 'cascade'],
  ['job_applications', 'job_id', 'job_postings', 'id', 'cascade'],
  // 0012_resume_builder_enhancements
  ['resume_documents', 'parent_version_id', 'resume_documents', 'id', 'set null'],
  // 0013_notifications
  ['notifications', 'user_id', 'auth.users', 'id', 'cascade'],
  ['notification_preferences', 'user_id', 'auth.users', 'id', 'cascade'],
  // 0014_onboarding, 0015_user_settings
  ['onboarding_state', 'user_id', 'auth.users', 'id', 'cascade'],
  ['user_settings', 'user_id', 'auth.users', 'id', 'cascade'],
  // 0016_social_sharing_badges_referrals
  ['badges', 'user_id', 'auth.users', 'id', 'cascade'],
  ['referral_codes', 'user_id', 'auth.users', 'id', 'cascade'],
  ['referral_tracking', 'referrer_id', 'auth.users', 'id', 'cascade'],
  ['referral_tracking', 'referee_id', 'auth.users', 'id', 'cascade'],
  ['social_shares', 'user_id', 'auth.users', 'id', 'cascade'],
  // 0018_video_conferencing
  ['video_conferencing_settings', 'user_id', 'auth.users', 'id', 'cascade'],
  ['video_sessions', 'user_id', 'auth.users', 'id', 'cascade'],
  ['video_audio_events', 'session_id', 'video_sessions', 'id', 'cascade'],
  ['video_audio_events', 'user_id', 'auth.users', 'id', 'cascade'],
  ['video_screen_share_events', 'session_id', 'video_sessions', 'id', 'cascade'],
  ['video_screen_share_events', 'user_id', 'auth.users', 'id', 'cascade'],
  // 0019_admin_dashboard: tickets and replies outlive the person (set null)
  ['support_tickets', 'user_id', 'auth.users', 'id', 'set null'],
  ['support_tickets', 'assigned_to', 'auth.users', 'id', 'set null'],
  ['support_messages', 'ticket_id', 'support_tickets', 'id', 'cascade'],
  ['support_messages', 'user_id', 'auth.users', 'id', 'set null'],
  ['fraud_flags', 'user_id', 'auth.users', 'id', 'cascade'],
  ['fraud_flags', 'resolved_by', 'auth.users', 'id', 'set null'],
  ['admin_users', 'user_id', 'auth.users', 'id', 'cascade'],
  // 0020_enterprise_teams (invited_by and audit_logs.user_id became SET NULL in 0033_data_integrity)
  ['organization_members', 'organization_id', 'organizations', 'id', 'cascade'],
  ['organization_members', 'user_id', 'auth.users', 'id', 'cascade'],
  ['organization_members', 'invited_by', 'auth.users', 'id', 'set null'],
  ['organization_invitations', 'organization_id', 'organizations', 'id', 'cascade'],
  ['organization_invitations', 'invited_by', 'auth.users', 'id', 'set null'],
  ['organization_analytics', 'organization_id', 'organizations', 'id', 'cascade'],
  ['saml_connections', 'organization_id', 'organizations', 'id', 'cascade'],
  ['audit_logs', 'organization_id', 'organizations', 'id', 'cascade'],
  ['audit_logs', 'user_id', 'auth.users', 'id', 'set null'],
  ['profiles', 'organization_id', 'organizations', 'id', 'set null'],
  // 0021_scheduling, 0022_integrations
  ['availability_slots', 'user_id', 'auth.users', 'id', 'cascade'],
  ['scheduled_interviews', 'host_user_id', 'auth.users', 'id', 'cascade'],
  ['user_integrations', 'user_id', 'auth.users', 'id', 'cascade'],
  // 0030_working_settings
  ['push_subscriptions', 'user_id', 'auth.users', 'id', 'cascade'],
  ['notification_log', 'user_id', 'auth.users', 'id', 'cascade'],
  ['analytics_report_schedules', 'user_id', 'auth.users', 'id', 'cascade'],
  // 0031_copilot_features
  ['playbooks', 'user_id', 'auth.users', 'id', 'cascade'],
  ['goals', 'user_id', 'auth.users', 'id', 'cascade'],
  ['goals', 'resume_document_id', 'resume_documents', 'id', 'set null'],
  ['goals', 'job_application_id', 'job_applications', 'id', 'set null'],
  ['goals', 'playbook_id', 'playbooks', 'id', 'set null'],
  ['materials', 'user_id', 'auth.users', 'id', 'cascade'],
  ['goal_materials', 'goal_id', 'goals', 'id', 'cascade'],
  ['goal_materials', 'material_id', 'materials', 'id', 'cascade'],
  ['goal_materials', 'user_id', 'auth.users', 'id', 'cascade'],
  ['memories', 'user_id', 'auth.users', 'id', 'cascade'],
  ['memories', 'goal_id', 'goals', 'id', 'set null'],
  ['memories', 'source_session_id', 'copilot_sessions', 'id', 'set null'],
  ['company_questions', 'user_id', 'auth.users', 'id', 'cascade'],
];

export const FOREIGN_KEYS = FK.map(([table, column, parent, parentColumn, onDelete]) => ({
  table,
  column,
  parent,
  parentColumn,
  onDelete,
  // Postgres's default name, which PostgREST accepts as an embedding hint (rel!name(...)).
  name: `${table}_${column}_fkey`,
}));

/** Primary keys other than `id`. (Every fake row still gets an `id`, which is harmless.) */
const PRIMARY_KEYS = {
  llm_settings: ['user_id'], // 0002
  stripe_customers: ['user_id'], // 0004
  stripe_subscriptions: ['stripe_subscription_id'], // 0004
  admin_users: ['user_id'], // 0019
  notification_log: ['user_id', 'dedupe_key'], // 0030
  goal_materials: ['goal_id', 'material_id'], // 0031
};

export function primaryKey(table) {
  return PRIMARY_KEYS[table] ?? ['id'];
}

/**
 * Unique constraints and unique indexes besides the primary key. NULLs never
 * clash, as in SQL, which also covers the partial indexes (`where x is not null`,
 * `where sso_config ? 'provider_id'`). A `->>` entry is an expression index.
 */
export const UNIQUE_KEYS = {
  usage_counters: [['user_id', 'counter_type', 'period_start']], // 0003
  stripe_customers: [['stripe_customer_id']], // 0004
  subscriptions: [['user_id', 'plan_id']], // 0005
  copilot_summaries: [['session_id', 'summary_type']], // 0007
  notification_preferences: [['user_id']], // 0013
  onboarding_state: [['user_id']], // 0014
  user_settings: [['user_id']], // 0015
  referral_codes: [['user_id'], ['code']], // 0016
  video_conferencing_settings: [['user_id']], // 0018
  daily_usage_stats: [['date']], // 0019
  organizations: [['slug'], ['sso_config->>provider_id']], // 0020, 0030
  organization_members: [['organization_id', 'user_id']], // 0020
  organization_invitations: [['token'], ['organization_id', 'email']], // 0020
  organization_analytics: [['organization_id', 'period_start', 'period_end', 'metric_type']], // 0020
  user_integrations: [['user_id', 'provider']], // 0022
  referral_tracking: [['referee_id']], // 0029
  push_subscriptions: [['endpoint']], // 0030
  company_questions: [['user_id', 'company_key', 'question_key']], // 0031
};

/** The primary key and every unique key of a table. */
export function uniqueKeys(table) {
  return [primaryKey(table), ...(UNIQUE_KEYS[table] ?? [])];
}

/** Postgres lower(btrim(x)): btrim with no characters given removes spaces only. */
export function lowerBtrim(value) {
  return value === null || value === undefined ? null : String(value).replace(/^ +| +$/g, '').toLowerCase();
}

/** `generated always as (…) stored` columns: computed on every write, never written by clients. */
export const GENERATED_COLUMNS = {
  // 0031_copilot_features
  company_questions: {
    company_key: (row) => lowerBtrim(row.company),
    question_key: (row) => lowerBtrim(row.question_text),
  },
};

const days = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

/**
 * Column defaults the app relies on (a row inserted without them gets them, as
 * in Postgres, so filters such as archived = false match). now() and
 * gen_random_uuid() columns (created_at, updated_at, id) are filled by the fake
 * for every table. `stamp` is the fake's clock.
 */
export function columnDefaults(table, stamp) {
  switch (table) {
    case 'admin_users':
      return { role: 'admin', permissions: ['read'] }; // 0019
    case 'analytics_report_schedules':
      return { enabled: true }; // 0030
    case 'audit_logs':
      return { details: {} }; // 0020
    case 'availability_slots':
      return { timezone: 'UTC', is_active: true }; // 0021
    case 'badges':
      return { awarded_at: stamp(), metadata: {} }; // 0016
    case 'company_questions':
      return { shared: false, source: 'reported', question_type: 'general' }; // 0031
    case 'copilot_events':
      return { payload: {} }; // 0007
    case 'copilot_sessions':
      // 0007 (the nullable columns are listed so the live copilot's `is.null` filters match)
      return {
        status: 'active',
        title: null,
        interview_session_id: null,
        metadata: {},
        stopped_at: null,
        duration_seconds: 0,
        consumed_minutes: 0,
      };
    case 'copilot_summaries':
      return { summary_type: 'final', payload: {} }; // 0007
    case 'cover_letters':
      return { tone: 'professional', status: 'draft', metadata: {} }; // 0010
    case 'fraud_flags':
      return { severity: 'medium', metadata: {}, resolved: false }; // 0019
    case 'goals':
      return { archived: false, round: 'other' }; // 0031
    case 'interview_questions':
      return { question_type: 'behavioral', difficulty: 'medium', order_index: 0, rubric: {} }; // 0009
    case 'interview_reports':
      return { mode: 'general', strengths: [], weaknesses: [], next_steps: [], rubric: {} }; // 0009
    case 'interview_sessions':
      return { title: 'Interview', status: 'draft', meta: {} }; // 0002
    case 'job_applications':
      return { stage: 'saved', status: 'active' }; // 0011
    case 'job_postings':
      return { requirements: [], metadata: {} }; // 0010
    case 'llm_settings':
      return { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.2, auto_optimize: true }; // 0002, 0017
    case 'materials':
      return { kind: 'notes' }; // 0031
    case 'memories':
      return { source: 'manual', goal_id: null }; // 0031
    case 'notification_preferences':
      return {
        email_interview_reminders: true,
        email_application_updates: true,
        email_ai_suggestions: true,
        email_weekly_digest: false,
        in_app_interview_reminders: true,
        in_app_application_updates: true,
        in_app_ai_suggestions: true,
      }; // 0013
    case 'notifications':
      return { data: {}, read: false }; // 0013
    case 'onboarding_state':
      return { current_step: 'welcome', completed_steps: [], profile_data: {} }; // 0014
    case 'organization_invitations':
      return { status: 'pending', token: randomUUID(), expires_at: days(7) }; // 0020
    case 'organization_members':
      return { status: 'active' }; // 0020
    case 'organizations':
      return { plan: 'free', sso_enabled: false, sso_config: {}, settings: {} }; // 0020
    case 'profiles':
      // 0014, 0015, 0031
      return { target_roles: [], onboarding_completed: false, language: 'en', timezone: 'UTC', email_notifications: true, memory_enabled: true };
    case 'referral_codes':
      return { referral_count: 0, conversion_count: 0 }; // 0016
    case 'referral_tracking':
      return { status: 'pending', clicked_at: stamp() }; // 0016
    case 'resume_documents':
      return { parsed_data: {}, keywords: [], version: 1, parse_status: 'pending' }; // 0012
    case 'resume_generations':
      return { status: 'queued', input: {}, output: {}, keyword_matches: [], suggested_keywords: [], bullet_suggestions: [] }; // 0002, 0012
    case 'saml_connections':
      return { attribute_mapping: { email: 'email', firstName: 'first_name', lastName: 'last_name' }, status: 'pending' }; // 0020
    case 'scheduled_interviews':
      return { title: 'Interview', status: 'scheduled', reminder_sent: false }; // 0021
    case 'social_shares':
      return { shared_at: stamp(), metadata: {} }; // 0016
    case 'stripe_subscriptions':
      return { cancel_at_period_end: false }; // 0004
    case 'subscriptions':
      return { status: 'active' }; // 0003
    case 'support_messages':
      return { is_from_admin: false }; // 0019
    case 'support_tickets':
      return { priority: 'medium', status: 'open' }; // 0019
    case 'usage_counters':
      return { used_amount: 0 }; // 0003
    case 'user_integrations':
      return { metadata: {} }; // 0022
    case 'user_settings':
      return { language: 'en', timezone: 'UTC', email_notifications: true, marketing_emails: false, two_factor_enabled: false }; // 0015
    case 'video_conferencing_settings':
      return {
        zoom_enabled: false,
        zoom_auto_capture: false,
        zoom_screen_share_detection: true,
        google_meet_enabled: false,
        google_meet_auto_capture: false,
        google_meet_screen_share_detection: true,
        ms_teams_enabled: false,
        ms_teams_auto_capture: false,
        ms_teams_screen_share_detection: true,
        audio_capture_enabled: true,
        audio_sample_rate: 16000,
        audio_channels: 1,
        screen_share_detection_enabled: true,
        preferred_platform: 'auto',
        auto_detect_platform: true,
        uses_desktop_meeting_app: false,
        auto_start_listening: false,
      }; // 0018, 0030
    case 'video_sessions':
      return { screen_share_active: false, audio_capture_active: false, status: 'active', metadata: {} }; // 0018
    default:
      return {};
  }
}

/** Tables the migrations define, as far as this file knows them (for checks that need the schema). */
export const KNOWN_TABLES = new Set([
  ...FOREIGN_KEYS.flatMap((fk) => [fk.table, fk.parent]).filter((table) => table !== 'auth.users'),
  ...Object.keys(UNIQUE_KEYS),
  ...Object.keys(PRIMARY_KEYS),
  'plans',
  'daily_usage_stats',
]);
