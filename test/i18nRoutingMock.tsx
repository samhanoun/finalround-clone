/**
 * Jest stand-in for `@/i18n/routing` (next-intl's navigation ships as ES modules
 * Jest can't load). Tests run in English, so links and redirects keep the path
 * as written, as the real helpers do apart from the /en prefix. The router is
 * Next's own, so tests that mock `next/navigation` still see every push.
 */
import React from 'react';
import { redirect as nextRedirect, usePathname as nextUsePathname, useRouter as nextUseRouter } from 'next/navigation';

type Href = string | { pathname: string; query?: Record<string, string> };

function toPath(href: Href): string {
  if (typeof href === 'string') return href;
  const query = href.query ? `?${new URLSearchParams(href.query).toString()}` : '';
  return `${href.pathname}${query}`;
}

export const routing = { locales: ['en', 'es', 'fr', 'de', 'pt'], defaultLocale: 'en', localePrefix: 'always' };

export const Link = React.forwardRef<HTMLAnchorElement, Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: Href; locale?: string; prefetch?: boolean; scroll?: boolean }>(
  function Link({ href, ...props }, ref) {
    // Router-only props aren't valid on <a>.
    const rest: Record<string, unknown> = { ...props };
    for (const key of ['locale', 'prefetch', 'scroll']) delete rest[key];
    return <a ref={ref} href={toPath(href)} {...rest} />;
  },
);

export function useRouter() {
  const router = nextUseRouter();
  return {
    ...router,
    push: (href: Href) => router.push(toPath(href)),
    replace: (href: Href) => router.replace(toPath(href)),
    prefetch: (href: Href) => router.prefetch(toPath(href)),
  };
}

export const usePathname = () => nextUsePathname();

export function redirect({ href }: { href: Href; locale: string }): never {
  return nextRedirect(toPath(href));
}

export const getPathname = ({ href }: { href: Href; locale: string }) => toPath(href);
