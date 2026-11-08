'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_MEETING_SETTINGS, type MeetingSettings } from '@/lib/meetingSettings';

/** Settings → Meeting apps, for the live copilot (the defaults until they load). */
export function useMeetingSettings(): MeetingSettings {
  const [settings, setSettings] = useState<MeetingSettings>(DEFAULT_MEETING_SETTINGS);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch('/api/settings/video-conferencing').catch(() => null);
      const json = res?.ok ? await res.json().catch(() => null) : null;
      if (!cancelled && json?.settings) setSettings({ ...DEFAULT_MEETING_SETTINGS, ...json.settings });
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return settings;
}
