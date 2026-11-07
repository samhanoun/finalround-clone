import type { User } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Team single sign-on through Supabase Auth's SAML 2.0 support: Supabase is
 * the service provider and verifies the identity provider's signed
 * assertions; this app never parses SAML itself.
 *
 * - A team owner gives their email domain(s) and the identity provider's
 *   metadata (a URL, or the XML). The server registers the provider through
 *   the Supabase Management API, which needs SUPABASE_MANAGEMENT_TOKEN (a
 *   personal access token; keep it server-only) and SAML turned on for the
 *   project (Pro plan and above).
 * - Members sign in with "Use single sign-on" (signInWithSSO by email domain);
 *   /api/auth/callback finishes the sign-in and adds them to the team.
 */

const MANAGEMENT_API = 'https://api.supabase.com/v1';

export class SsoSetupError extends Error {
  constructor(
    readonly code: 'not_configured' | 'saml_not_enabled' | 'token_rejected' | 'invalid_metadata' | 'domain_taken' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'SsoSetupError';
  }
}

function supabaseUrl(): string | null {
  return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, '') || null;
}

/** The project ref: SUPABASE_PROJECT_REF, or the subdomain of a *.supabase.co URL. */
export function projectRef(): string | null {
  const explicit = process.env.SUPABASE_PROJECT_REF?.trim();
  if (explicit) return explicit;
  const url = supabaseUrl();
  const match = url ? /^https:\/\/([a-z0-9]{20})\.supabase\.co$/i.exec(url) : null;
  return match?.[1] ?? null;
}

export function isSsoManageable(): boolean {
  return Boolean(process.env.SUPABASE_MANAGEMENT_TOKEN?.trim() && projectRef());
}

/** What the identity provider's admin needs (Supabase Auth is the service provider). */
export function serviceProviderInfo() {
  const base = supabaseUrl();
  if (!base) return null;
  return {
    entityId: `${base}/auth/v1/sso/saml/metadata`,
    metadataUrl: `${base}/auth/v1/sso/saml/metadata?download=true`,
    acsUrl: `${base}/auth/v1/sso/saml/acs`,
    nameIdFormat: 'emailAddress',
  };
}

export { domainFromEmail, normalizeDomains } from '@/lib/ssoDomain';

type ProviderInput = { metadataUrl?: string; metadataXml?: string; domains: string[] };

async function managementFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const token = process.env.SUPABASE_MANAGEMENT_TOKEN?.trim();
  const ref = projectRef();
  if (!token || !ref) throw new SsoSetupError('not_configured', 'Single sign-on isn’t set up on this server.');

  const res = await fetch(`${MANAGEMENT_API}/projects/${ref}/config/auth/sso${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (res.ok) return body;

  const message = typeof body?.message === 'string' ? body.message : `HTTP ${res.status}`;
  if (res.status === 404) throw new SsoSetupError('saml_not_enabled', 'SAML isn’t turned on for this Supabase project.');
  if (res.status === 401 || res.status === 403) throw new SsoSetupError('token_rejected', 'The server’s Supabase management token was refused.');
  if (/domain/i.test(message) && /(exist|taken|already|use)/i.test(message)) {
    throw new SsoSetupError('domain_taken', 'Another identity provider already uses that domain.');
  }
  if (res.status === 400 || res.status === 422) throw new SsoSetupError('invalid_metadata', message);
  throw new SsoSetupError('failed', message);
}

function providerBody(input: ProviderInput) {
  return {
    ...(input.metadataUrl ? { metadata_url: input.metadataUrl } : {}),
    ...(input.metadataXml ? { metadata_xml: input.metadataXml } : {}),
    domains: input.domains,
  };
}

export async function registerSamlProvider(input: ProviderInput): Promise<string> {
  const created = (await managementFetch('/providers', {
    method: 'POST',
    body: JSON.stringify({ type: 'saml', ...providerBody(input) }),
  })) as { id?: string } | null;
  if (!created?.id) throw new SsoSetupError('failed', 'Supabase returned no provider id.');
  return created.id;
}

export async function updateSamlProvider(providerId: string, input: ProviderInput): Promise<void> {
  await managementFetch(`/providers/${encodeURIComponent(providerId)}`, { method: 'PUT', body: JSON.stringify(providerBody(input)) });
}

export async function removeSamlProvider(providerId: string): Promise<void> {
  try {
    await managementFetch(`/providers/${encodeURIComponent(providerId)}`, { method: 'DELETE' });
  } catch (error) {
    // Already gone at Supabase: nothing left to remove.
    if (!(error instanceof SsoSetupError && error.code === 'saml_not_enabled')) throw error;
  }
}

/** The SSO provider a user signed in through ("sso:<uuid>" identities), if any. */
export function ssoProviderIdOf(user: Pick<User, 'app_metadata' | 'identities'>): string | null {
  const fromIdentity = user.identities?.find((identity) => identity.provider?.startsWith('sso:'))?.provider;
  const raw = fromIdentity ?? (typeof user.app_metadata?.provider === 'string' ? user.app_metadata.provider : '');
  return raw.startsWith('sso:') ? raw.slice(4) || null : null;
}

/** Adds an SSO user to the team that owns their identity provider. Returns that team's id. */
export async function joinSsoOrganization(user: Pick<User, 'id' | 'app_metadata' | 'identities'>): Promise<string | null> {
  const providerId = ssoProviderIdOf(user);
  if (!providerId) return null;
  const admin = createAdminClient();
  const { data: org } = await admin
    .from('organizations')
    .select('id')
    .eq('sso_enabled', true)
    .eq('sso_config->>provider_id', providerId)
    .maybeSingle();
  if (!org?.id) return null;
  const { error } = await admin.from('organization_members').upsert(
    { organization_id: org.id, user_id: user.id, role: 'member', status: 'active', joined_at: new Date().toISOString() },
    { onConflict: 'organization_id,user_id', ignoreDuplicates: true },
  );
  if (error) throw new Error(`Could not add the SSO member: ${error.message}`);
  return org.id as string;
}
