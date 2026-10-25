'use client';

import { useEffect, useRef, useState } from 'react';

/** How long a session waits after meeting audio sharing stops before it ends itself. */
export const SHARING_GRACE_MS = 120_000;

function clock(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Shown when the user stops sharing the meeting: the session (and its billed
 * minutes) ends after a grace period unless they start listening again or
 * choose to keep it open, for example to type questions instead.
 */
export function AutoEndNotice({
  startedAt,
  graceMs = SHARING_GRACE_MS,
  onExpire,
  onKeepOpen,
}: {
  startedAt: number;
  graceMs?: number;
  onExpire: () => void;
  onKeepOpen: () => void;
}) {
  const [remaining, setRemaining] = useState(graceMs);
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    const deadline = startedAt + graceMs;
    let expired = false;
    const tick = () => {
      const left = Math.max(0, deadline - Date.now());
      setRemaining(left);
      if (left === 0 && !expired) {
        expired = true;
        clearInterval(timer);
        onExpireRef.current();
      }
    };
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [startedAt, graceMs]);

  return (
    <div className="error row" role="alert" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <span>
        Meeting audio sharing stopped. This session ends in <strong>{clock(remaining)}</strong> unless you start listening
        again.
      </span>
      <button className="button" type="button" onClick={onKeepOpen}>
        Keep session open
      </button>
    </div>
  );
}
