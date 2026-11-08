'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { desktopPlatform, isDesktopApp } from '@/lib/desktop';

const noSubscription = () => () => undefined;

/** On a Mac the window buttons sit at the left of the strip, so the title moves right of them. */
const MAC_STRIP = { padding: '0 16px 0 80px' } as const;

/**
 * The desktop app hides the OS title bar (the window buttons are drawn over
 * the strip: top right on Windows, top left on a Mac). This strip takes its
 * place on every page: it moves the window when dragged, and
 * `html[data-desktop]` (set to the platform) pushes the page below it.
 *
 * `title`: the app's name, from the locale layout (this renders outside the translations provider).
 */
export function DesktopFrame({ title }: { title: string }) {
  const desktop = useSyncExternalStore(noSubscription, isDesktopApp, () => false);
  const platform = useSyncExternalStore(noSubscription, desktopPlatform, () => null);

  useEffect(() => {
    if (!desktop) return;
    document.documentElement.setAttribute('data-desktop', platform ?? '');
    return () => document.documentElement.removeAttribute('data-desktop');
  }, [desktop, platform]);

  if (!desktop) return null;
  return (
    <div className="desktopTitlebar" aria-hidden="true" style={platform === 'darwin' ? MAC_STRIP : undefined}>
      {title}
    </div>
  );
}
