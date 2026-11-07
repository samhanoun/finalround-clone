'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Document Picture-in-Picture (Chrome/Edge 116+): a small always-on-top window
 * holding real DOM, so answers stay visible while the meeting tab is in front.
 * https://developer.chrome.com/docs/web-platform/document-picture-in-picture
 */

type PipRequestOptions = { width?: number; height?: number };
type DocumentPictureInPictureApi = {
  requestWindow(options?: PipRequestOptions): Promise<Window>;
};

function pipApi(): DocumentPictureInPictureApi | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { documentPictureInPicture?: DocumentPictureInPictureApi }).documentPictureInPicture ?? null;
}

const noSubscription = () => () => undefined;

const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'"\s)]+))\s*\)/g;

/**
 * Makes the url(…) references in copied CSS absolute. Rules keep the URLs as
 * written (`../media/font.woff2`, relative to the stylesheet), but in the
 * floating window they would resolve against the page instead, and the
 * fonts would go missing.
 */
export function absolutizeCssUrls(cssText: string, base: string): string {
  return cssText.replace(CSS_URL, (match, double?: string, single?: string, bare?: string) => {
    const value = (double ?? single ?? bare ?? '').trim();
    if (!value || /^(data:|blob:|#)/i.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return match;
    try {
      return `url("${new URL(value, base).href}")`;
    } catch {
      return match;
    }
  });
}

/**
 * Copies the page's styles and theme into the floating window, so components
 * rendered there look the same. Stylesheets we can't read (cross-origin) are
 * linked instead.
 */
export function copyDocumentStyles(source: Document, target: Document): void {
  for (const sheet of Array.from(source.styleSheets)) {
    try {
      const style = target.createElement('style');
      style.textContent = absolutizeCssUrls(
        Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join('\n'),
        sheet.href ?? source.baseURI,
      );
      target.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = target.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        target.head.appendChild(link);
      }
    }
  }
  target.documentElement.className = source.documentElement.className;
  target.documentElement.lang = source.documentElement.lang;
  for (const attribute of ['data-theme', 'style']) {
    const value = source.documentElement.getAttribute(attribute);
    if (value !== null) target.documentElement.setAttribute(attribute, value);
  }
  target.body.className = source.body.className;
}

export function useDocumentPip() {
  // Feature detection without a hydration mismatch: the server always says no.
  const supported = useSyncExternalStore(noSubscription, () => pipApi() !== null, () => false);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);

  /** Call from a click: the browser only opens the window during a user gesture. */
  const open = useCallback(async (options: PipRequestOptions & { title?: string } = {}) => {
    const api = pipApi();
    if (!api) return null;
    const win = await api.requestWindow({ width: options.width, height: options.height });
    copyDocumentStyles(document, win.document);
    if (options.title) win.document.title = options.title;
    win.addEventListener('pagehide', () => setPipWindow((current) => (current === win ? null : current)), { once: true });
    setPipWindow(win);
    return win;
  }, []);

  const close = useCallback(() => {
    setPipWindow((current) => {
      current?.close();
      return null;
    });
  }, []);

  // Leaving the page (or ending the session) closes the window too.
  useEffect(
    () => () => {
      pipWindow?.close();
    },
    [pipWindow],
  );

  return { supported, pipWindow, open, close };
}
