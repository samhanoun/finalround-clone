import { createHmac } from 'node:crypto';
import { Resolver } from 'node:dns/promises';

/**
 * Proof that a team owns the email domains it sends to its identity provider.
 *
 * Supabase doesn't check domain ownership for SAML providers, so without this
 * any team owner could claim gmail.com, or another company's domain, and send
 * those people to an identity provider they control (and stop the real company
 * from setting up single sign-on). Before a domain is registered, its DNS must
 * have a TXT record at `_apex-round-sso.<domain>` holding a value only this
 * server can compute for this team and domain.
 */

export const RECORD_PREFIX = '_apex-round-sso';
const VALUE_PREFIX = 'apex-round-sso=';

export type VerificationRecord = { domain: string; type: 'TXT'; name: string; value: string };

export class VerificationUnavailableError extends Error {}

function secret(): string {
  const value = process.env.SSO_VERIFY_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new VerificationUnavailableError('SSO_VERIFY_SECRET or SUPABASE_SERVICE_ROLE_KEY is needed to verify domains.');
  return value;
}

/** The TXT record a team adds to prove it owns `domain` (stable: the same team and domain always get the same value). */
export function verificationRecord(organizationId: string, domain: string): VerificationRecord {
  const token = createHmac('sha256', secret()).update(`sso-domain:${organizationId}:${domain}`).digest('hex').slice(0, 40);
  return { domain, type: 'TXT', name: `${RECORD_PREFIX}.${domain}`, value: `${VALUE_PREFIX}${token}` };
}

export type TxtLookup = (name: string) => Promise<string[][]>;

function defaultLookup(): TxtLookup {
  const resolver = new Resolver({ timeout: 4000, tries: 2 });
  return (name) => resolver.resolveTxt(name);
}

/** The records still missing from DNS, in the order given; empty when every domain is proven. */
export async function missingVerifications(
  organizationId: string,
  domains: string[],
  lookup: TxtLookup = defaultLookup(),
): Promise<VerificationRecord[]> {
  const missing: VerificationRecord[] = [];
  for (const domain of domains) {
    const record = verificationRecord(organizationId, domain);
    // A long TXT value can arrive split into several strings; join them back.
    const found = await lookup(record.name)
      .then((answers) => answers.some((chunks) => chunks.join('').trim() === record.value))
      .catch(() => false); // NXDOMAIN, no TXT record, timeout: not proven
    if (!found) missing.push(record);
  }
  return missing;
}
