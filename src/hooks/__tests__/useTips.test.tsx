import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTips } from '../useTips';
import { TIPS } from '../../config/tips';

const PAUSE_MS = 30_000;
const HOLD_MS = 20_000;

describe('useTips', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays hidden and schedules nothing while inactive', () => {
    const { result } = renderHook(() => useTips(false));
    expect(result.current.isVisible).toBe(false);
    expect(result.current.tipKey).toBe(-1);

    act(() => {
      vi.advanceTimersByTime(HOLD_MS * 5);
    });

    expect(result.current.isVisible).toBe(false);
  });

  it('shows one tip per cycle and then the next from the deck', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // 1 tip per cycle, min pause
    const { result } = renderHook(() => useTips(true));

    expect(result.current.isVisible).toBe(false);

    act(() => {
      vi.advanceTimersByTime(PAUSE_MS);
    });

    expect(result.current.isVisible).toBe(true);
    expect(result.current.tipKey).toBe(0);
    expect(TIPS.map((tip) => tip.textKey)).toContain(
      result.current.tip.textKey,
    );

    // Cycle completes: the tip hides again.
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    expect(result.current.isVisible).toBe(false);

    // Next cycle pulls a fresh tip from the same shuffled deck.
    act(() => {
      vi.advanceTimersByTime(PAUSE_MS);
    });
    expect(result.current.isVisible).toBe(true);
    expect(result.current.tipKey).toBe(1);
  });

  it('clears a pending pause timer on unmount', () => {
    const { unmount } = renderHook(() => useTips(true));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears a running cycle interval on unmount', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9); // 2 tips per cycle
    const { result, unmount } = renderHook(() => useTips(true));

    act(() => {
      vi.advanceTimersByTime(46_000);
    });
    expect(result.current.isVisible).toBe(true);

    // One hold interval elapses but the cycle needs a second tip.
    act(() => {
      vi.advanceTimersByTime(HOLD_MS);
    });
    expect(result.current.tipKey).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
