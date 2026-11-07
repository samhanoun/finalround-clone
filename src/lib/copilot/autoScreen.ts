/**
 * Automatic Solve screen: while the meeting is shared, a tiny fingerprint of
 * the screen is taken every few seconds. When the picture changes to
 * something new (a new problem, a new editor tab) and then holds still, the
 * screen is solved without a click. A cool-down and "not while answering"
 * keep it from firing on every scroll.
 */

/** 64-bit difference hash of a 9×8 grayscale thumbnail, as 16 hex digits. */
export function differenceHash(gray: ArrayLike<number>, width = 9, height = 8): string {
  let bits = '';
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      bits += gray[y * width + x] > gray[y * width + x + 1] ? '1' : '0';
    }
  }
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function hammingDistance(a: string, b: string): number {
  let distance = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      distance += x & 1;
      x >>= 1;
    }
  }
  return distance + Math.abs(a.length - b.length) * 4;
}

export type AutoScreenOptions = {
  /** How different from the last solved screen a new one must be (of 64 bits). */
  changeBits?: number;
  /** Samples the new picture must hold still for. */
  stableSamples?: number;
  /** At least this long between automatic solves. */
  cooldownMs?: number;
};

export class AutoScreenWatcher {
  private readonly changeBits: number;
  private readonly stableSamples: number;
  private readonly cooldownMs: number;
  private candidate: string | null = null;
  private stable = 0;
  private lastSolved: string | null = null;
  private lastSolvedAt = -Infinity;

  constructor(options: AutoScreenOptions = {}) {
    this.changeBits = options.changeBits ?? 12;
    this.stableSamples = options.stableSamples ?? 2;
    this.cooldownMs = options.cooldownMs ?? 30_000;
  }

  /** Feed one fingerprint; true when this screen should be solved now. */
  feed(signature: string, now: number, busy: boolean): boolean {
    if (this.candidate !== null && hammingDistance(signature, this.candidate) <= 3) this.stable += 1;
    else {
      this.candidate = signature;
      this.stable = 1;
    }
    if (this.stable < this.stableSamples || busy || now - this.lastSolvedAt < this.cooldownMs) return false;
    if (this.lastSolved !== null && hammingDistance(this.candidate, this.lastSolved) < this.changeBits) return false;
    this.lastSolved = this.candidate;
    this.lastSolvedAt = now;
    return true;
  }

  /** A manual Solve screen counts too, so the same screen isn't solved again right after. */
  noteSolved(signature: string | null, now: number): void {
    if (signature) this.lastSolved = signature;
    this.lastSolvedAt = now;
  }
}
