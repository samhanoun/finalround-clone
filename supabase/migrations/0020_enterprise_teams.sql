-- Enterprise Features: Multi-tenancy, Teams, SSO/SAML
-- Apply with: supabase db push or psql

-- Enable UUID generation
create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- 1) organizations (multi-tenancy)
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  logo_url text,
  plan text not null default 'free' check (plan in ('free', 'team', 'enterprise')),
  sso_enabled boolean not null default false,
  sso_provider text check (sso_provider is null or sso_provider in ('saml', 'oidc')),
  sso_config jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_organizations_updated_at on public.organizations;
create trigger set_organizations_updated_at
before update on public.organizations
for each row execute procedure public.set_updated_at();

-- 2) organization_members
create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  status text not null default 'active' check (status in ('active', 'pending', 'invited')),
  invited_by uuid references auth.users(id),
  invitation_token text,
  invitation_expires_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, user_id)
);

drop trigger if exists set_organization_members_updated_at on public.organization_members;
create trigger set_organization_members_updated_at
before update on public.organization_members
for each row execute procedure public.set_updated_at();

create index if not exists org_members_org_id_idx on public.organization_members(organization_id);
create index if not exists org_members_user_id_idx on public.organization_members(user_id);
create index if not exists org_members_status_idx on public.organization_members(status);

-- 3) organization_invitations (for team invites)
create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'member', 'viewer')),
  invited_by uuid not null references auth.users(id),
  token text unique not null default gen_random_uuid()::text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'cancelled')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  unique(organization_id, email)
);

-- 4) organization_analytics (for team dashboard)
create table if not exists public.organization_analytics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  metric_type text not null,
  metric_value numeric not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(organization_id, period_start, period_end, metric_type)
);

create index if not exists org_analytics_org_id_idx on public.organization_analytics(organization_id);
create index if not exists org_analytics_period_idx on public.organization_analytics(period_start, period_end);

-- 5) saml_connections (SSO/SAML scaffolding)
create table if not exists public.saml_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  idp_entity_id text not null,
  idp_sso_url text not null,
  idp_certificate text not null,
  sp_entity_id text not null,
  sp_acs_url text not null,
  sp_metadata_url text,
  attribute_mapping jsonb default '{"email": "email", "firstName": "first_name", "lastName": "last_name"}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'active', 'disabled', 'error')),
  last_sync_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_saml_connections_updated_at on public.saml_connections;
create trigger set_saml_connections_updated_at
before update on public.saml_connections
for each row execute procedure public.set_updated_at();

-- 6) audit_logs (for enterprise tracking)
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id),
  action text not null,
  resource_type text not null,
  resource_id text,
  details jsonb default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_org_id_idx on public.audit_logs(organization_id);
create index if not exists audit_logs_user_id_idx on public.audit_logs(user_id);
create index if not exists audit_logs_created_at_idx on public.audit_logs(created_at);

-- Membership lookup for RLS. Runs as the function owner so policies on
-- organization_members don't recurse into their own table.
create or replace function public.org_role(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.organization_members
  where organization_id = p_org_id
    and user_id = auth.uid()
    and status = 'active';
$$;

revoke execute on function public.org_role(uuid) from public, anon;
grant execute on function public.org_role(uuid) to authenticated;

-- RLS
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.organization_analytics enable row level security;
alter table public.saml_connections enable row level security;
alter table public.audit_logs enable row level security;

-- Members can read their organization; only owners can update it
create policy "organizations_read_member" on public.organizations
for select to authenticated
using ((select public.org_role(id)) is not null);

create policy "organizations_update_owner" on public.organizations
for update to authenticated
using ((select public.org_role(id)) = 'owner')
with check ((select public.org_role(id)) = 'owner');

-- Members can read other members; owners can manage members
create policy "organization_members_read" on public.organization_members
for select to authenticated
using ((select public.org_role(organization_id)) is not null);

create policy "organization_members_manage_owner" on public.organization_members
for all to authenticated
using ((select public.org_role(organization_id)) = 'owner')
with check ((select public.org_role(organization_id)) = 'owner');

-- Invitations: members read, owners/admins manage
create policy "org_invitations_read" on public.organization_invitations
for select to authenticated
using ((select public.org_role(organization_id)) is not null);

create policy "org_invitations_manage" on public.organization_invitations
for all to authenticated
using ((select public.org_role(organization_id)) in ('owner', 'admin'))
with check ((select public.org_role(organization_id)) in ('owner', 'admin'));

-- Analytics: members read
create policy "org_analytics_read" on public.organization_analytics
for select to authenticated
using ((select public.org_role(organization_id)) is not null);

-- SAML: owners/admins read, owners manage
create policy "saml_connections_read" on public.saml_connections
for select to authenticated
using ((select public.org_role(organization_id)) in ('owner', 'admin'));

create policy "saml_connections_manage" on public.saml_connections
for all to authenticated
using ((select public.org_role(organization_id)) = 'owner')
with check ((select public.org_role(organization_id)) = 'owner');

-- Audit logs: org owners/admins read
create policy "audit_logs_read" on public.audit_logs
for select to authenticated
using ((select public.org_role(organization_id)) in ('owner', 'admin'));

-- Function to log audit events (server-side only)
create or replace function public.log_audit_event(
  p_organization_id uuid,
  p_user_id uuid,
  p_action text,
  p_resource_type text,
  p_resource_id text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (organization_id, user_id, action, resource_type, resource_id, details)
  values (p_organization_id, p_user_id, p_action, p_resource_type, p_resource_id, p_details);
end;
$$;

revoke execute on function public.log_audit_event(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.log_audit_event(uuid, uuid, text, text, text, jsonb) to service_role;

-- Update profiles to support organization_id
alter table public.profiles add column if not exists organization_id uuid references public.organizations(id) on delete set null;

-- Add index for profile lookups
create index if not exists profiles_org_id_idx on public.profiles(organization_id);
