/** Quietest level the meters show; anything below reads as 0%. */
export const METER_FLOOR_DB = -60;

/** Levels above this count as "hearing audio" (normal speech sits around -30 to -10 dBFS). */
export const SIGNAL_THRESHOLD_DB = -45;

export function rmsToDb(rms: number): number {
  return 20 * Math.log10(Math.max(rms, 1e-6));
}

/** Maps an RMS level (0..1) onto a 0-100 meter using a -60..0 dBFS scale. */
export function levelToPercent(rms: number): number {
  const percent = ((rmsToDb(rms) - METER_FLOOR_DB) / -METER_FLOOR_DB) * 100;
  return Math.min(100, Math.max(0, percent));
}

export function hasSignal(rms: number): boolean {
  return rmsToDb(rms) > SIGNAL_THRESHOLD_DB;
}
