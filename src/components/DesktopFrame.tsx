'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { isDesktopApp } from '@/lib/desktop';

const noSubscription = () => () => undefined;

/**
 * The Windows app hides the OS title bar (the window buttons are drawn over
 * the top-right corner). This strip takes its place on every page: it moves
 * the window when dragged, and `html[data-desktop]` pushes the page below it.
 */
/** `title`: the app's name, from the locale layout (this renders outside the translations provider). */
export function DesktopFrame({ title }: { title: string }) {
  const desktop = useSyncExternalStore(noSubscription, isDesktopApp, () => false);

  useEffect(() => {
    if (!desktop) return;
    document.documentElement.setAttribute('data-desktop', '');
    return () => document.documentElement.removeAttribute('data-desktop');
  }, [desktop]);

  if (!desktop) return null;
  return (
    <div className="desktopTitlebar" aria-hidden="true">
      {title}
    </div>
  );
}
