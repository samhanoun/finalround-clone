import { AutoScreenWatcher, differenceHash, hammingDistance } from '@/lib/copilot/autoScreen';

describe('screen fingerprints', () => {
  it('hashes a 9×8 thumbnail into 64 bits and measures differences', () => {
    const rising = Array.from({ length: 72 }, (_, i) => i % 9);
    const falling = Array.from({ length: 72 }, (_, i) => 8 - (i % 9));
    expect(differenceHash(rising)).toBe('0000000000000000');
    expect(differenceHash(falling)).toBe('ffffffffffffffff');
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hammingDistance('00000000000000ff', '0000000000000000')).toBe(8);
  });
});

describe('AutoScreenWatcher', () => {
  const A = '0000000000000000';
  const B = 'ffff0000ffff0000';
  const C = '00ff00ff00ff00ff';

  it('solves a screen once it holds still, and not again until it changes', () => {
    const watcher = new AutoScreenWatcher({ cooldownMs: 0 });
    expect(watcher.feed(A, 0, false)).toBe(false); // first look
    expect(watcher.feed(A, 2500, false)).toBe(true); // held still: solve
    expect(watcher.feed(A, 5000, false)).toBe(false); // same screen
    expect(watcher.feed(B, 7500, false)).toBe(false); // changed, not settled yet
    expect(watcher.feed(B, 10_000, false)).toBe(true);
  });

  it('waits while an answer is being written and during the cool-down', () => {
    const watcher = new AutoScreenWatcher({ cooldownMs: 30_000 });
    watcher.feed(A, 0, false);
    expect(watcher.feed(A, 2500, false)).toBe(true);
    watcher.feed(C, 5000, false);
    expect(watcher.feed(C, 7500, false)).toBe(false); // cool-down
    expect(watcher.feed(C, 40_000, true)).toBe(false); // busy answering
    expect(watcher.feed(C, 42_500, false)).toBe(true);
  });
});
