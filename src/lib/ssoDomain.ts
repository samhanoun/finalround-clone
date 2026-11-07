/** Email domains for single sign-on (safe to import in the browser). */

const DOMAIN = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

export function isDomain(value: string): boolean {
  return DOMAIN.test(value);
}

/** Lower-cased, de-duplicated, valid domains ("@acme.com" and "Acme.com" both become "acme.com"). */
export function normalizeDomains(input: string[]): string[] {
  const out = new Set<string>();
  for (const raw of input) {
    const domain = raw.trim().toLowerCase().replace(/^@/, '');
    if (isDomain(domain)) out.add(domain);
  }
  return [...out].slice(0, 10);
}

/**
 * Free email providers: shared by everyone, so no team can own them for single
 * sign-on. (DNS verification would refuse them anyway; this says why up front.)
 */
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr', 'hotmail.co.uk',
  'hotmail.es', 'hotmail.de', 'live.com', 'live.fr', 'msn.com', 'yahoo.com', 'yahoo.fr', 'yahoo.es', 'yahoo.de',
  'yahoo.co.uk', 'yahoo.com.br', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me',
  'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'gmx.net', 'gmx.fr', 'web.de', 't-online.de', 'mail.com',
  'zoho.com', 'yandex.com', 'yandex.ru', 'mail.ru', 'fastmail.com', 'hey.com', 'tutanota.com', 'tuta.io',
  'qq.com', '163.com', '126.com', 'orange.fr', 'free.fr', 'laposte.net', 'wanadoo.fr', 'sfr.fr', 'libero.it',
  'uol.com.br', 'bol.com.br', 'terra.com.br', 'ig.com.br', 'telefonica.net', 'movistar.es',
]);

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.trim().toLowerCase().replace(/^@/, ''));
}

export function domainFromEmail(email: string): string | null {
  const domain = email.trim().toLowerCase().split('@')[1];
  return domain && isDomain(domain) ? domain : null;
}
