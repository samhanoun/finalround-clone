import { isPublicEmailDomain } from '@/lib/ssoDomain';
import { missingVerifications, RECORD_PREFIX, verificationRecord, VerificationUnavailableError } from '@/lib/ssoVerification';

const TEAM = '00000000-0000-4000-8000-000000000001';
const OTHER_TEAM = '00000000-0000-4000-8000-000000000002';

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-for-tests';
  delete process.env.SSO_VERIFY_SECRET;
});

describe('verificationRecord', () => {
  it('is a TXT record under _apex-round-sso, stable for one team and domain', () => {
    const record = verificationRecord(TEAM, 'acme.com');
    expect(record).toMatchObject({ domain: 'acme.com', type: 'TXT', name: `${RECORD_PREFIX}.acme.com` });
    expect(record.value).toMatch(/^apex-round-sso=[0-9a-f]{40}$/);
    expect(verificationRecord(TEAM, 'acme.com').value).toBe(record.value);
  });

  it('differs per team, per domain and per server secret, so it cannot be reused or guessed', () => {
    const value = verificationRecord(TEAM, 'acme.com').value;
    expect(verificationRecord(OTHER_TEAM, 'acme.com').value).not.toBe(value);
    expect(verificationRecord(TEAM, 'acme.io').value).not.toBe(value);
    process.env.SSO_VERIFY_SECRET = 'a-dedicated-secret';
    expect(verificationRecord(TEAM, 'acme.com').value).not.toBe(value);
  });

  it('needs a server secret', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => verificationRecord(TEAM, 'acme.com')).toThrow(VerificationUnavailableError);
  });
});

describe('missingVerifications', () => {
  it('passes a domain whose TXT record holds the value, even split into chunks', async () => {
    const { name, value } = verificationRecord(TEAM, 'acme.com');
    const lookup = jest.fn(async (host: string) => (host === name ? [['v=spf1 -all'], [value.slice(0, 20), value.slice(20)]] : []));
    await expect(missingVerifications(TEAM, ['acme.com'], lookup)).resolves.toEqual([]);
    expect(lookup).toHaveBeenCalledWith(name);
  });

  it('returns the record to add when it is missing, wrong, or DNS fails', async () => {
    const otherTeams = verificationRecord(OTHER_TEAM, 'acme.io').value;
    const lookup = jest.fn(async (host: string) => {
      if (host.endsWith('acme.io')) return [[otherTeams]]; // another team's proof doesn't count
      if (host.endsWith('acme.dev')) throw Object.assign(new Error('queryTxt ENOTFOUND'), { code: 'ENOTFOUND' });
      return [];
    });
    const missing = await missingVerifications(TEAM, ['acme.com', 'acme.io', 'acme.dev'], lookup);
    expect(missing.map((record) => record.domain)).toEqual(['acme.com', 'acme.io', 'acme.dev']);
    expect(missing[1]).toEqual(verificationRecord(TEAM, 'acme.io'));
  });
});

describe('isPublicEmailDomain', () => {
  it('flags free email providers, however they are typed', () => {
    expect(isPublicEmailDomain('gmail.com')).toBe(true);
    expect(isPublicEmailDomain(' @Outlook.com ')).toBe(true);
    expect(isPublicEmailDomain('proton.me')).toBe(true);
    expect(isPublicEmailDomain('acme.com')).toBe(false);
  });
});
