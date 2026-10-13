import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSettingsAutoResize } from '../useSettingsAutoResize';
import { __mockWindow } from '../../../testUtils/mocks/tauri-window';

const CHROME = 148;

/** Reads the LogicalSize passed to the most recent `setSize` call. */
function lastSize(): { width: number; height: number } {
  const calls = (
    __mockWindow.setSize as unknown as { mock: { calls: unknown[][] } }
  ).mock.calls;
  return calls[calls.length - 1][0] as { width: number; height: number };
}

describe('useSettingsAutoResize', () => {
  let el: HTMLDivElement;
  let height = 300;

  beforeEach(() => {
    height = 300;
    el = document.createElement('div');
    Object.defineProperty(el, 'scrollHeight', {
      get: () => height,
      configurable: true,
    });
    __mockWindow.setSize.mockClear();
    // The shared setup mocks rAF synchronously, which would recurse forever in
    // the easing loop; make it inert for this suite.
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 0);
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing when there is no element', () => {
    renderHook(() => useSettingsAutoResize(null, CHROME, 0));
    expect(__mockWindow.setSize).not.toHaveBeenCalled();
  });

  it('sizes the window to the natural content height on mount', () => {
    const { result } = renderHook(() => useSettingsAutoResize(el, CHROME, 0));

    expect(__mockWindow.setSize).toHaveBeenCalledTimes(1);
    const size = lastSize();
    expect(size.width).toBe(580);
    expect(size.height).toBe(height + CHROME);
    expect(result.current).toBe(false);
  });

  it('clamps to the maximum height and reports it', () => {
    height = 900;
    const { result } = renderHook(() => useSettingsAutoResize(el, CHROME, 0));

    expect(lastSize().height).toBe(700);
    expect(result.current).toBe(true);
  });

  it('animates towards a new target when the content height changes', () => {
    const { result, rerender } = renderHook(
      ({ rev }) => useSettingsAutoResize(el, CHROME, rev),
      { initialProps: { rev: 0 } },
    );
    expect(result.current).toBe(false);

    height = 800;
    rerender({ rev: 1 });

    // The easing loop only starts (rAF is inert here) but clamping is reported.
    expect(result.current).toBe(true);
  });

  it('ignores a negligible height delta', () => {
    const { rerender } = renderHook(
      ({ rev }) => useSettingsAutoResize(el, CHROME, rev),
      { initialProps: { rev: 0 } },
    );
    expect(__mockWindow.setSize).toHaveBeenCalledTimes(1);

    height = 302; // target 450 vs last sent 448 → below the 4px threshold
    rerender({ rev: 1 });

    expect(__mockWindow.setSize).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending animation frame on unmount', () => {
    const { rerender, unmount } = renderHook(
      ({ rev }) => useSettingsAutoResize(el, CHROME, rev),
      { initialProps: { rev: 0 } },
    );

    height = 800;
    rerender({ rev: 1 });

    unmount();
    expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
  });

  it('eases to the target and stops at the end of the animation', () => {
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      // A frame far enough in the future that the easing completes at once.
      cb(performance.now() + 1000);
      return 1;
    });

    const { rerender } = renderHook(
      ({ rev }) => useSettingsAutoResize(el, CHROME, rev),
      { initialProps: { rev: 0 } },
    );
    expect(lastSize().height).toBe(height + CHROME);

    height = 800;
    rerender({ rev: 1 });

    expect(lastSize().height).toBe(700);
  });

  it('keeps requesting frames while the easing is still running', () => {
    let frames = 0;
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      frames += 1;
      // Only the first frame runs (elapsed ≈ 0), so the loop must schedule
      // another frame and then stop when the mock declines to invoke it.
      if (frames === 1) cb(performance.now());
      return frames;
    });

    const { rerender } = renderHook(
      ({ rev }) => useSettingsAutoResize(el, CHROME, rev),
      { initialProps: { rev: 0 } },
    );
    const callsAfterMount = (
      __mockWindow.setSize as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.length;

    height = 800;
    rerender({ rev: 1 });

    // The first frame lands on the start height, so nothing new is sent.
    expect(
      (__mockWindow.setSize as unknown as { mock: { calls: unknown[][] } }).mock
        .calls.length,
    ).toBe(callsAfterMount);
    expect(frames).toBeGreaterThan(1);
  });
});
