/**
 * The Apex Round mark: a summit, with a voice signal crossing its base in
 * Ember. Also the source of the app and desktop icons (public/icon.svg).
 */
export function ApexMark({ size = 36, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 44 44"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <rect x="1" y="1" width="42" height="42" rx="12" fill="#111B30" stroke="#2C3B5E" />
      <path d="M11 30 L22 12 L33 30" fill="none" stroke="#E8EDF7" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M14.5 27 h4.5 l2 -4.2 l3 7.2 l2 -3 h4" fill="none" stroke="#FFB547" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ApexWordmark({ size = 32 }: { size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <ApexMark size={size} />
      <span
        style={{
          fontFamily: 'var(--font-title)',
          fontWeight: 500,
          fontSize: Math.round(size * 0.5),
          letterSpacing: '-0.01em',
          color: 'var(--paper)',
        }}
      >
        Apex Round
      </span>
    </span>
  );
}
