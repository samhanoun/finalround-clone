'use client';

import { useSyncExternalStore } from 'react';
import { useLocale } from 'next-intl';

const subscribe = () => () => {};

/** True once the page runs in the browser (false while rendering on the server and hydrating). */
export function useInBrowser(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/**
 * A date and time in the viewer's own time zone. The server doesn't know it,
 * so this renders only in the browser (nothing on the server), and the
 * server-rendered page never disagrees with the hydrated one.
 */
export function LocalDateTime({ iso, options }: { iso: string; options?: Intl.DateTimeFormatOptions }) {
  const locale = useLocale();
  const inBrowser = useInBrowser();
  if (!inBrowser) return null;
  const text = new Intl.DateTimeFormat(
    locale,
    options ?? { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' },
  ).format(new Date(iso));
  return <time dateTime={iso}>{text}</time>;
}
