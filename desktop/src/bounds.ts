/**
 * Geometry for the floating answer window: where it opens, how the keyboard
 * moves and resizes it, and keeping it on a screen that exists (a saved
 * position can point at a monitor that has since been unplugged). Pure, so
 * it's unit tested; main.ts passes in the displays' work areas.
 */

export type Rect = { x: number; y: number; width: number; height: number };

export const ANSWER_WINDOW = {
  /** What the web app asks for (AnswerPanel's WINDOW_SIZE). */
  defaultWidth: 420,
  defaultHeight: 620,
  minWidth: 280,
  minHeight: 200,
  /** Gap to the screen edge where it first opens. */
  margin: 24,
  /** One press of a move or resize shortcut. */
  step: 24,
} as const;

const MAX_SIDE = 16_384;

/** A Rect from disk or elsewhere, or null if it isn't one. */
export function normalizeRect(raw: unknown): Rect | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { x, y, width, height } = raw as Record<string, unknown>;
  const values = [x, y, width, height];
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  const rect = { x: Math.round(x as number), y: Math.round(y as number), width: Math.round(width as number), height: Math.round(height as number) };
  if (rect.width < 1 || rect.height < 1 || rect.width > MAX_SIDE || rect.height > MAX_SIDE) return null;
  if (Math.abs(rect.x) > MAX_SIDE * 4 || Math.abs(rect.y) > MAX_SIDE * 4) return null;
  return rect;
}

function overlap(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function distanceToCenter(rect: Rect, area: Rect): number {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = Math.max(area.x - cx, 0, cx - (area.x + area.width));
  const dy = Math.max(area.y - cy, 0, cy - (area.y + area.height));
  return Math.hypot(dx, dy);
}

/** The work area the rect is mostly on, or the nearest one when it's on none. */
export function areaFor(rect: Rect, areas: readonly Rect[]): Rect | null {
  if (areas.length === 0) return null;
  let best = areas[0];
  let bestOverlap = -1;
  for (const area of areas) {
    const amount = overlap(rect, area);
    if (amount > bestOverlap) {
      best = area;
      bestOverlap = amount;
    }
  }
  if (bestOverlap > 0) return best;
  return [...areas].sort((a, b) => distanceToCenter(rect, a) - distanceToCenter(rect, b))[0];
}

/** Whether every pixel of the rect is on some screen (displays don't overlap, so areas add up). */
export function isFullyVisible(rect: Rect, areas: readonly Rect[]): boolean {
  const visible = areas.reduce((sum, area) => sum + overlap(rect, area), 0);
  return visible >= rect.width * rect.height;
}

/** Shrinks the rect to fit `area` if needed and slides it inside. */
export function fitInto(rect: Rect, area: Rect): Rect {
  const width = Math.min(rect.width, area.width);
  const height = Math.min(rect.height, area.height);
  const x = Math.min(Math.max(rect.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(rect.y, area.y), area.y + area.height - height);
  return { x, y, width, height };
}

/** The rect, unchanged if it's fully on screen, else fitted into the display it's mostly on (or the nearest). */
export function keepVisible(rect: Rect, areas: readonly Rect[]): Rect {
  if (isFullyVisible(rect, areas)) return rect;
  const area = areaFor(rect, areas);
  return area ? fitInto(rect, area) : rect;
}

/** Where the window first opens: the top-right corner of the main display's work area. */
export function defaultAnswerBounds(area: Rect, size: { width: number; height: number } = { width: ANSWER_WINDOW.defaultWidth, height: ANSWER_WINDOW.defaultHeight }): Rect {
  return fitInto(
    {
      x: area.x + area.width - size.width - ANSWER_WINDOW.margin,
      y: area.y + ANSWER_WINDOW.margin,
      width: size.width,
      height: size.height,
    },
    area,
  );
}

export type Direction = 'left' | 'right' | 'up' | 'down';

const DELTA: Record<Direction, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

/**
 * One keyboard move. It may cross onto a neighbouring display, but never
 * leaves the screens: at the outer edge it stops.
 */
export function moveBy(rect: Rect, direction: Direction, areas: readonly Rect[], step: number = ANSWER_WINDOW.step): Rect {
  const [dx, dy] = DELTA[direction];
  const moved = { ...rect, x: rect.x + dx * step, y: rect.y + dy * step };
  if (isFullyVisible(moved, areas)) return moved;
  const area = areaFor(rect, areas);
  return area ? fitInto(moved, area) : moved;
}

/**
 * One keyboard resize from the top-left corner: right and down grow it, left
 * and up shrink it, within the minimum size and its display.
 */
export function resizeBy(rect: Rect, direction: Direction, areas: readonly Rect[], step: number = ANSWER_WINDOW.step): Rect {
  const [dw, dh] = DELTA[direction];
  const area = areaFor(rect, areas);
  const maxWidth = area ? area.x + area.width - rect.x : Infinity;
  const maxHeight = area ? area.y + area.height - rect.y : Infinity;
  const width = Math.max(ANSWER_WINDOW.minWidth, Math.min(rect.width + dw * step, Math.max(maxWidth, ANSWER_WINDOW.minWidth)));
  const height = Math.max(ANSWER_WINDOW.minHeight, Math.min(rect.height + dh * step, Math.max(maxHeight, ANSWER_WINDOW.minHeight)));
  const resized = { ...rect, width, height };
  return area ? keepVisible(resized, areas) : resized;
}
