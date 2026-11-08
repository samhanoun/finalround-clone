/**
 * Which display Start listening and Solve screen capture. Pure: main.ts
 * passes Electron's displays and desktopCapturer sources in.
 */

/** The fields of Electron's Display this needs. */
export type DisplayLike = {
  id: number;
  label?: string;
  size: { width: number; height: number };
  scaleFactor: number;
};

/** Same shape as `DesktopDisplay` in src/lib/desktop.ts. */
export type DesktopDisplay = { id: string; label: string; primary: boolean; width: number; height: number };

/**
 * Displays in the order the system lists them, with the size in physical
 * pixels (what people know their monitor as) and a name: the monitor's own
 * name when the system has one, else "Display 2" in the app's language.
 */
export function describeDisplays(
  displays: readonly DisplayLike[],
  primaryId: number,
  fallbackName: (n: number) => string,
): DesktopDisplay[] {
  return displays.map((display, index) => ({
    id: String(display.id),
    label: display.label?.trim() || fallbackName(index + 1),
    primary: display.id === primaryId,
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor),
  }));
}

/** The display to capture: the chosen one while it's connected, else the main display. */
export function effectiveDisplayId(chosen: string | null, displays: readonly { id: string }[], primaryId: string): string {
  return chosen !== null && displays.some((display) => display.id === chosen) ? chosen : primaryId;
}

/**
 * The desktopCapturer source for a display: the chosen one, else the main
 * display, else the first screen (some systems leave display_id empty).
 */
export function pickScreenSource<T extends { display_id: string }>(
  sources: readonly T[],
  chosen: string | null,
  primaryId: string,
): T | undefined {
  return (
    (chosen !== null ? sources.find((source) => source.display_id === chosen) : undefined) ??
    sources.find((source) => source.display_id === primaryId) ??
    sources[0]
  );
}
