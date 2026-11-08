import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerOrganizationClient, checkOrganizationAccess } from '@/lib/organizations';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/rateLimit';
import {
  isSsoManageable,
  normalizeDomains,
  registerSamlProvider,
  removeSamlProvider,
  serviceProviderInfo,
  SsoSetupError,
  updateSamlProvider,
} from '@/lib/sso';
import { isPublicEmailDomain } from '@/lib/ssoDomain';
import { missingVerifications, VerificationUnavailableError } from '@/lib/ssoVerification';

/**
 * Team → Single sign-on (src/lib/sso.ts). Owners and admins can read it; only
 * the owner changes it. The organization's sso_* columns are written here
 * with the service role (migration 0030 keeps them out of users' reach).
 * A domain is only sent to Supabase once the team has proven it owns it with
 * a DNS TXT record (src/lib/ssoVerification.ts); public email domains never.
 */

type Params = { params: Promise<{ id: string }> };

type SsoConfig = { provider_id?: string; domains?: string[]; idp_metadata_url?: string | null; updated_at?: string };

const SaveSchema = z
  .object({
    domains: z.array(z.string().max(253)).min(1).max(10),
    metadataUrl: z.string().url().startsWith('https://').max(2000).optional(),
    metadataXml: z.string().min(50).max(200_000).optional(),
  })
  .refine((body) => Boolean(body.metadataUrl) !== Boolean(body.metadataXml), { message: 'metadata_url_or_xml' });

async function loadOrg(id: string) {
  const { data } = await createAdminClient()
    .from('organizations')
    .select('sso_enabled, sso_provider, sso_config')
    .eq('id', id)
    .maybeSingle<{ sso_enabled: boolean; sso_provider: string | null; sso_config: SsoConfig | null }>();
  return data;
}

function view(org: Awaited<ReturnType<typeof loadOrg>>) {
  const config = org?.sso_config ?? {};
  return {
    enabled: Boolean(org?.sso_enabled && config.provider_id),
    domains: config.domains ?? [],
    metadataUrl: config.idp_metadata_url ?? null,
    manageable: isSsoManageable(),
    serviceProvider: serviceProviderInfo(),
  };
}

function setupError(error: unknown) {
  if (error instanceof SsoSetupError) {
    const status = error.code === 'not_configured' || error.code === 'saml_not_enabled' ? 503 : error.code === 'domain_taken' ? 409 : 422;
    return NextResponse.json({ error: error.code, message: error.message }, { status });
  }
  console.error('[sso] setup failed', error instanceof Error ? error.message : error);
  return NextResponse.json({ error: 'failed' }, { status: 500 });
}

// GET /api/teams/[id]/sso
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await getServerOrganizationClient();
  if (!(await checkOrganizationAccess(supabase, id, ['owner', 'admin']))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(view(await loadOrg(id)));
}

// PUT /api/teams/[id]/sso {domains, metadataUrl | metadataXml} - turn on, or update
export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await getServerOrganizationClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await checkOrganizationAccess(supabase, id, ['owner']))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const rl = await rateLimit({ key: `team_sso:${user.id}`, limit: 10, windowMs: 60 * 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parse = SaveSchema.safeParse(await request.json().catch(() => null));
  if (!parse.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const domains = normalizeDomains(parse.data.domains);
  if (!domains.length) return NextResponse.json({ error: 'invalid_domains' }, { status: 400 });

  const publicDomains = domains.filter(isPublicEmailDomain);
  if (publicDomains.length) return NextResponse.json({ error: 'public_domain', domains: publicDomains }, { status: 400 });

  const org = await loadOrg(id);
  // Domains this team already proved stay proven; every new one needs its TXT record.
  const proven = new Set(org?.sso_enabled ? (org.sso_config?.domains ?? []) : []);
  try {
    const records = await missingVerifications(id, domains.filter((domain) => !proven.has(domain)));
    if (records.length) return NextResponse.json({ error: 'domain_unverified', records }, { status: 422 });
  } catch (error) {
    if (error instanceof VerificationUnavailableError) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    throw error;
  }

  const input = { domains, metadataUrl: parse.data.metadataUrl, metadataXml: parse.data.metadataXml };
  try {
    const existing = org?.sso_config?.provider_id;
    let providerId = existing;
    if (existing) await updateSamlProvider(existing, input);
    else providerId = await registerSamlProvider(input);

    const { error } = await createAdminClient()
      .from('organizations')
      .update({
        sso_enabled: true,
        sso_provider: 'saml',
        sso_config: {
          provider_id: providerId,
          domains,
          idp_metadata_url: parse.data.metadataUrl ?? null,
          updated_at: new Date().toISOString(),
        },
      })
      .eq('id', id);
    if (error) throw new Error(error.message);
  } catch (error) {
    return setupError(error);
  }
  return NextResponse.json(view(await loadOrg(id)));
}

// DELETE /api/teams/[id]/sso - turn off and remove the identity provider
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await getServerOrganizationClient();
  if (!(await checkOrganizationAccess(supabase, id, ['owner']))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const org = await loadOrg(id);
  try {
    if (org?.sso_config?.provider_id) await removeSamlProvider(org.sso_config.provider_id);
    const { error } = await createAdminClient()
      .from('organizations')
      .update({ sso_enabled: false, sso_provider: null, sso_config: {} })
      .eq('id', id);
    if (error) throw new Error(error.message);
  } catch (error) {
    return setupError(error);
  }
  return NextResponse.json(view(await loadOrg(id)));
}
