import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SAMLConnection, SAMLStatus } from './organizations';

export interface SAMLConfig {
  idp_entity_id: string;
  idp_sso_url: string;
  idp_certificate: string;
  attribute_mapping?: Record<string, string>;
}

export interface SAMLAssertion {
  email: string;
  first_name?: string;
  last_name?: string;
  groups?: string[];
}

// Generate SP metadata
export function generateSPMetadata(organizationId: string, baseUrl: string): string {
  const entityId = `${baseUrl}/saml/metadata/${organizationId}`;
  const acsUrl = `${baseUrl}/saml/acs/${organizationId}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acsUrl}" index="0" isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;
}

// Generate AuthnRequest for SAML SSO
export function generateAuthnRequest(
  organizationId: string,
  baseUrl: string,
  relayState?: string
): { request: string; entityId: string } {
  const entityId = `${baseUrl}/saml/metadata/${organizationId}`;
  const acsUrl = `${baseUrl}/saml/acs/${organizationId}`;
  const requestId = `_${Math.random().toString(36).substring(2)}`;
  const issueInstant = new Date().toISOString();

  let request = `<?xml version="1.0" encoding="UTF-8"?>
<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
  ID="${requestId}"
  Version="2.0"
  IssueInstant="${issueInstant}"
  AssertionConsumerServiceURL="${acsUrl}"
  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
  <saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${entityId}</saml:Issuer>
  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>
</samlp:AuthnRequest>`;

  // Add RelayState if provided
  if (relayState) {
    request = request.replace('</samlp:AuthnRequest>', `<samlp:RelayState>${relayState}</samlp:RelayState></samlp:AuthnRequest>`);
  }

  // Base64 encode
  const encodedRequest = Buffer.from(request).toString('base64');

  return {
    request: encodedRequest,
    entityId,
  };
}

// Parse SAML Response (simplified - in production use a proper SAML library)
export function parseSAMLResponse(
  samlResponse: string,
  idpCertificate: string
): SAMLAssertion | null {
  try {
    // Decode base64 response
    const decoded = Buffer.from(samlResponse, 'base64').toString('utf-8');
    
    // In a real implementation, you would:
    // 1. Verify XML signature using idpCertificate
    // 2. Check conditions (NotBefore, NotOnOrAfter)
    // 3. Extract attributes
    
    // Simplified parsing - extract email from Assertion
    const emailMatch = decoded.match(/<saml:Attribute Name="email">[\s\S]*?<saml:AttributeValue[^>]*>([^<]+)<\/saml:AttributeValue>/);
    const email = emailMatch ? emailMatch[1] : null;
    
    if (!email) {
      // Try NameID
      const nameIdMatch = decoded.match(/<saml:NameID[^>]*>([^<]+)<\/saml:NameID>/);
      if (nameIdMatch) {
        return { email: nameIdMatch[1] };
      }
      return null;
    }

    // Extract first/last name if available
    const firstNameMatch = decoded.match(/<saml:Attribute Name="firstName">[\s\S]*?<saml:AttributeValue[^>]*>([^<]+)<\/saml:AttributeValue>/);
    const lastNameMatch = decoded.match(/<saml:Attribute Name="lastName">[\s\S]*?<saml:AttributeValue[^>]*>([^<]+)<\/saml:AttributeValue>/);

    // Extract groups if available
    const groupMatches = decoded.match(/<saml:Attribute Name="groups">[\s\S]*?<saml:AttributeValue[^>]*>([^<]+)<\/saml:AttributeValue>/g);
    const groups = groupMatches?.map(g => g.replace(/[\s\S]*?>([^<]+)<\/saml:AttributeValue>/, '$1'));

    return {
      email,
      first_name: firstNameMatch ? firstNameMatch[1] : undefined,
      last_name: lastNameMatch ? lastNameMatch[1] : undefined,
      groups: groups || undefined,
    };
  } catch (error) {
    console.error('SAML response parse error:', error);
    return null;
  }
}

// SSO/SAML Database operations
export async function getSAMLConnection(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string
): Promise<SAMLConnection | null> {
  const { data, error } = await supabase
    .from('saml_connections')
    .select('*')
    .eq('organization_id', organizationId)
    .single();

  if (error) return null;
  return data;
}

export async function createSAMLConnection(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string,
  config: SAMLConfig
): Promise<SAMLConnection> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const spEntityId = `${baseUrl}/saml/metadata/${organizationId}`;
  const spAcsUrl = `${baseUrl}/saml/acs/${organizationId}`;

  const { data, error } = await supabase
    .from('saml_connections')
    .insert({
      organization_id: organizationId,
      idp_entity_id: config.idp_entity_id,
      idp_sso_url: config.idp_sso_url,
      idp_certificate: config.idp_certificate,
      sp_entity_id: spEntityId,
      sp_acs_url: spAcsUrl,
      attribute_mapping: config.attribute_mapping || {
        email: 'email',
        firstName: 'first_name',
        lastName: 'last_name',
      },
      status: 'pending',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateSAMLConnection(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string,
  connectionId: string,
  updates: Partial<Pick<SAMLConnection, 'status' | 'error_message' | 'last_sync_at'>>
): Promise<void> {
  const { error } = await supabase
    .from('saml_connections')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', connectionId)
    .eq('organization_id', organizationId);

  if (error) throw error;
}

export async function deleteSAMLConnection(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string,
  connectionId: string
): Promise<void> {
  const { error } = await supabase
    .from('saml_connections')
    .delete()
    .eq('id', connectionId)
    .eq('organization_id', organizationId);

  if (error) throw error;
}

export async function enableOrganizationSSO(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string,
  provider: 'saml' | 'oidc'
): Promise<void> {
  const { error } = await supabase
    .from('organizations')
    .update({
      sso_enabled: true,
      sso_provider: provider,
    })
    .eq('id', organizationId);

  if (error) throw error;
}

export async function disableOrganizationSSO(
  supabase: ReturnType<typeof createServerClient>,
  organizationId: string
): Promise<void> {
  const { error } = await supabase
    .from('organizations')
    .update({
      sso_enabled: false,
      sso_provider: null,
    })
    .eq('id', organizationId);

  if (error) throw error;
}

// OIDC Support (simplified)
export interface OIDCConfig {
  issuer: string;
  client_id: string;
  client_secret: string;
  scope?: string;
}

export interface OIDCTokens {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

export async function exchangeOIDCCode(
  config: OIDCConfig,
  code: string,
  redirectUri: string
): Promise<OIDCTokens> {
  const response = await fetch(`${config.issuer}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: config.client_id,
      client_secret: config.client_secret,
    }),
  });

  if (!response.ok) {
    throw new Error('OIDC token exchange failed');
  }

  return response.json();
}

export async function getOIDCUserInfo(
  issuer: string,
  accessToken: string
): Promise<{ email: string; name?: string; given_name?: string; family_name?: string }> {
  const response = await fetch(`${issuer}/userinfo`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('OIDC userinfo fetch failed');
  }

  return response.json();
}
