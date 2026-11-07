import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANSWER_WINDOW,
  areaFor,
  defaultAnswerBounds,
  isFullyVisible,
  keepVisible,
  moveBy,
  normalizeRect,
  resizeBy,
  type Rect,
} from './bounds';

// A 1920×1080 main display (taskbar at the bottom) and a 2560×1440 one to its right.
const MAIN: Rect = { x: 0, y: 0, width: 1920, height: 1040 };
const RIGHT: Rect = { x: 1920, y: 0, width: 2560, height: 1400 };
const AREAS = [MAIN, RIGHT];

test('the answer window first opens in the top-right corner of the main display', () => {
  assert.deepEqual(defaultAnswerBounds(MAIN), { x: 1920 - 420 - 24, y: 24, width: 420, height: 620 });
  // A small screen: it shrinks to fit.
  assert.deepEqual(defaultAnswerBounds({ x: 0, y: 0, width: 800, height: 560 }), { x: 356, y: 0, width: 420, height: 560 });
});

test('keepVisible leaves a visible window alone and pulls a lost one back', () => {
  const visible = { x: 100, y: 100, width: 420, height: 620 };
  assert.deepEqual(keepVisible(visible, AREAS), visible);
  // Straddling two displays side by side is fine.
  const straddling = { x: 1800, y: 100, width: 420, height: 620 };
  assert.deepEqual(keepVisible(straddling, AREAS), straddling);
  // Saved on a monitor that has been unplugged: back onto the nearest screen.
  assert.deepEqual(keepVisible({ x: 5000, y: 200, width: 420, height: 620 }, AREAS), { x: 4480 - 420, y: 200, width: 420, height: 620 });
  // Half below the taskbar.
  assert.deepEqual(keepVisible({ x: 100, y: 800, width: 420, height: 620 }, [MAIN]), { x: 100, y: 1040 - 620, width: 420, height: 620 });
  // Bigger than the screen: shrinks.
  assert.deepEqual(keepVisible({ x: 0, y: 0, width: 3000, height: 3000 }, [MAIN]), { x: 0, y: 0, width: 1920, height: 1040 });
});

test('areaFor picks the display a window is mostly on, else the nearest', () => {
  assert.equal(areaFor({ x: 1900, y: 0, width: 400, height: 400 }, AREAS), RIGHT);
  assert.equal(areaFor({ x: -900, y: 0, width: 400, height: 400 }, AREAS), MAIN);
  assert.equal(areaFor({ x: 0, y: 0, width: 1, height: 1 }, []), null);
});

test('moveBy steps 24 px, crosses onto a neighbouring display and stops at the outer edge', () => {
  const rect = { x: 100, y: 100, width: 420, height: 620 };
  assert.deepEqual(moveBy(rect, 'right', AREAS), { ...rect, x: 124 });
  assert.deepEqual(moveBy(rect, 'up', AREAS), { ...rect, y: 76 });
  const atEdge = { x: 1500, y: 100, width: 420, height: 620 };
  assert.deepEqual(moveBy(atEdge, 'right', AREAS), { ...atEdge, x: 1524 });
  assert.equal(isFullyVisible(moveBy(atEdge, 'right', AREAS), AREAS), true);
  const topLeft = { x: 0, y: 0, width: 420, height: 620 };
  assert.deepEqual(moveBy(topLeft, 'left', AREAS), topLeft);
  assert.deepEqual(moveBy(topLeft, 'up', AREAS), topLeft);
  const nearEdge = { x: 10, y: 0, width: 420, height: 620 };
  assert.deepEqual(moveBy(nearEdge, 'left', AREAS), { ...nearEdge, x: 0 });
});

test('resizeBy grows right and down, shrinks left and up, within limits', () => {
  const rect = { x: 100, y: 100, width: 420, height: 620 };
  assert.deepEqual(resizeBy(rect, 'right', AREAS), { ...rect, width: 444 });
  assert.deepEqual(resizeBy(rect, 'down', AREAS), { ...rect, height: 644 });
  assert.deepEqual(resizeBy(rect, 'left', AREAS), { ...rect, width: 396 });
  assert.deepEqual(resizeBy(rect, 'up', AREAS), { ...rect, height: 596 });
  const smallest = { x: 100, y: 100, width: ANSWER_WINDOW.minWidth, height: ANSWER_WINDOW.minHeight };
  assert.deepEqual(resizeBy(smallest, 'left', AREAS), smallest);
  assert.deepEqual(resizeBy(smallest, 'up', AREAS), smallest);
  // Never past the bottom of its display.
  const tall = { x: 100, y: 400, width: 420, height: 640 };
  assert.deepEqual(resizeBy(tall, 'down', [MAIN]), tall);
});

test('normalizeRect rounds numbers and refuses garbage', () => {
  assert.deepEqual(normalizeRect({ x: 1.6, y: 2.2, width: 300.5, height: 200 }), { x: 2, y: 2, width: 301, height: 200 });
  assert.equal(normalizeRect(null), null);
  assert.equal(normalizeRect({ x: 0, y: 0, width: 0, height: 10 }), null);
  assert.equal(normalizeRect({ x: Number.NaN, y: 0, width: 10, height: 10 }), null);
  assert.equal(normalizeRect({ x: 0, y: 0, width: 1e9, height: 10 }), null);
});
