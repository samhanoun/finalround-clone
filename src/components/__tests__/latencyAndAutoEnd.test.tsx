import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { AutoEndNotice } from '@/components/copilot/AutoEndNotice';
import { LatencyDrawer } from '@/components/copilot/LatencyDrawer';
import type { TurnTiming } from '@/lib/copilot/latency';

describe('AutoEndNotice', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('counts down and ends the session once, after the grace period', () => {
    const onExpire = jest.fn();
    render(<AutoEndNotice startedAt={Date.now()} graceMs={3_000} onExpire={onExpire} onKeepOpen={jest.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('ends in 0:03');

    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('ends in 0:02');
    expect(onExpire).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('lets the user keep the session open', () => {
    const onKeepOpen = jest.fn();
    render(<AutoEndNotice startedAt={Date.now()} onExpire={jest.fn()} onKeepOpen={onKeepOpen} />);
    expect(screen.getByRole('alert')).toHaveTextContent('ends in 2:00');
    fireEvent.click(screen.getByRole('button', { name: 'Keep session open' }));
    expect(onKeepOpen).toHaveBeenCalled();
  });
});

function store(turns: TurnTiming[]) {
  return { subscribeTurns: () => () => undefined, getTurns: () => turns };
}

function turn(partial: Partial<TurnTiming>): TurnTiming {
  return {
    category: 'behavioral',
    trigger: 'gate',
    via: 'heuristic',
    outcome: 'answered',
    speechEndedAt: 0,
    finalAt: 400,
    gateAt: 420,
    firstTokenAt: 1_100,
    doneAt: 3_000,
    serverTtftMs: 520,
    ...partial,
  };
}

describe('LatencyDrawer', () => {
  it('waits for the first answered question', () => {
    render(<LatencyDrawer answers={store([])} />);
    expect(screen.getByText(/0 questions this session/)).toBeInTheDocument();
    expect(screen.getByText(/Timings appear after the first answered question/)).toBeInTheDocument();
  });

  it('shows p50/p95 per stage over answered questions and flags stages over target', () => {
    render(
      <LatencyDrawer
        answers={store([
          turn({}),
          turn({ firstTokenAt: 4_000, doneAt: 5_000 }), // 4 s from speech end: over the 3 s p95 target
          turn({ outcome: 'superseded', firstTokenAt: null, doneAt: null }),
          turn({ trigger: 'manual', speechEndedAt: null, finalAt: null, category: 'coding' }),
        ])}
      />,
    );

    expect(screen.getByText(/4 questions this session · speech end → first words p50 1.10 s/)).toBeInTheDocument();
    const row = screen.getByRole('rowheader', { name: 'Speech end → first token' }).closest('tr')!;
    expect(row).toHaveTextContent('1.10 s4.00 s2p50 ≤ 1.50 s, p95 ≤ 3.00 s');
    expect(row.className).toMatch(/latencyOver/);
    expect(screen.getAllByRole('row').some((r) => r.textContent?.startsWith('ManualAnswered'))).toBe(true);
    expect(screen.getAllByRole('row').some((r) => r.textContent?.startsWith('behavioralReplaced'))).toBe(true);
  });
});
