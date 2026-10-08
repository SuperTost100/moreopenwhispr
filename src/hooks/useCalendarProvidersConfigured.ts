import { useEffect, useState } from "react";

export interface CalendarProvidersConfigured {
  google: boolean;
  microsoft: boolean;
}

// Assumed available until main answers, so nothing flickers away on builds
// that do have the OAuth clients.
const ALL_CONFIGURED: CalendarProvidersConfigured = { google: true, microsoft: true };
let cached: CalendarProvidersConfigured | null = null;

/** Which calendar providers this build can sign in to (their OAuth client ids are build secrets). */
export function useCalendarProvidersConfigured(): CalendarProvidersConfigured {
  const [configured, setConfigured] = useState<CalendarProvidersConfigured>(
    cached ?? ALL_CONFIGURED
  );

  useEffect(() => {
    if (cached) return;
    let active = true;
    window.electronAPI
      ?.getCalendarProvidersConfigured?.()
      .then((result) => {
        if (!result) return;
        cached = result;
        if (active) setConfigured(result);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return configured;
}
