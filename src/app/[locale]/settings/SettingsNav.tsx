'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './Settings.module.css';

export type SettingsNavItem = { id: string; label: string; desktopOnly?: boolean };

/** Where a section counts as "current": its top has passed this line. */
function readingLine() {
  return window.innerWidth < 768 ? 140 : window.innerWidth < 1024 ? 120 : 96;
}

function reducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/**
 * The list of sections: a sticky column on desktop, a strip under the top bar
 * on phones. The current section is marked as you scroll; a click scrolls to
 * it and moves focus there. Coming back from Stripe (?billing=…) opens Billing.
 */
export function SettingsNav({ items, label }: { items: SettingsNavItem[]; label: string }) {
  const [active, setActive] = useState(items[0]?.id ?? '');
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      // Hidden sections (Desktop app in a browser) have no layout box.
      const visible = items
        .map((item) => document.getElementById(item.id))
        .filter((el): el is HTMLElement => Boolean(el && el.offsetParent !== null));
      if (!visible.length) return;
      let current = visible[0].id;
      const line = readingLine();
      for (const el of visible) {
        if (el.getBoundingClientRect().top - line <= 0) current = el.id;
      }
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) current = visible[visible.length - 1].id;
      setActive(current);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [items]);

  // A link from elsewhere (#notifications) or the return from Stripe: the sections above
  // load their data after the first paint, so scroll again once they have settled.
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).has('billing') ? 'billing' : window.location.hash.slice(1);
    if (!target || !items.some((item) => item.id === target)) return;
    const timer = window.setTimeout(() => {
      document.getElementById(target)?.scrollIntoView({ block: 'start' });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [items]);

  // On phones, keep the current link in view inside the strip.
  useEffect(() => {
    const list = listRef.current;
    const link = list?.querySelector<HTMLElement>(`[data-section="${active}"]`);
    if (!list || !link || list.scrollWidth <= list.clientWidth) return;
    const left = link.offsetLeft - 16;
    const right = link.offsetLeft + link.offsetWidth + 16 - list.clientWidth;
    if (list.scrollLeft > left) list.scrollTo({ left, behavior: reducedMotion() ? 'auto' : 'smooth' });
    else if (list.scrollLeft < right) list.scrollTo({ left: right, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [active]);

  function go(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
    const section = document.getElementById(id);
    if (!section) return;
    event.preventDefault();
    section.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    section.focus({ preventScroll: true });
    window.history.replaceState(window.history.state, '', `#${id}`);
    setActive(id);
  }

  return (
    <nav className={styles.nav} aria-label={label}>
      <ul className={styles.navList} ref={listRef}>
        {items.map((item) => (
          <li key={item.id} className={item.desktopOnly ? styles.desktopOnly : undefined}>
            <a
              href={`#${item.id}`}
              data-section={item.id}
              className={styles.navLink}
              aria-current={active === item.id ? 'true' : undefined}
              onClick={(event) => go(event, item.id)}
            >
              <span className={styles.navChip}>{item.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
