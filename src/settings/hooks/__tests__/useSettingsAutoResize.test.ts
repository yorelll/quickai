import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSettingsAutoResize } from '../useSettingsAutoResize';
import { __mockWindow } from '../../../testUtils/mocks/tauri-window';

const CHROME = 148;

function setSizeCallCount(): number {
  return (__mockWindow.setSize as unknown as { mock: { calls: unknown[][] } })
    .mock.calls.length;
}

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

  it('clamps to the minimum height', () => {
    height = 10;
    renderHook(() => useSettingsAutoResize(el, CHROME, 0));

    expect(lastSize().height).toBe(280);
  });

  it('resizes once to the new target when the content height changes', () => {
    const { rerender } = renderHook(
      ({ rev }) => useSettingsAutoResize(el, CHROME, rev),
      { initialProps: { rev: 0 } },
    );
    expect(setSizeCallCount()).toBe(1);

    height = 800;
    rerender({ rev: 1 });

    // Exactly one extra call — no per-frame resize storm.
    expect(setSizeCallCount()).toBe(2);
    expect(lastSize().height).toBe(700);
  });

  it('reports clamping for the new tab', () => {
    const { result, rerender } = renderHook(
      ({ rev }) => useSettingsAutoResize(el, CHROME, rev),
      { initialProps: { rev: 0 } },
    );
    expect(result.current).toBe(false);

    height = 800;
    rerender({ rev: 1 });

    expect(result.current).toBe(true);
  });

  it('ignores a negligible height delta', () => {
    const { rerender } = renderHook(
      ({ rev }) => useSettingsAutoResize(el, CHROME, rev),
      { initialProps: { rev: 0 } },
    );
    expect(setSizeCallCount()).toBe(1);

    height = 302; // target 450 vs last sent 448 → below the 4px threshold
    rerender({ rev: 1 });

    expect(setSizeCallCount()).toBe(1);
  });

  it('resizes when the chrome height changes (banner appears)', () => {
    const { rerender } = renderHook(
      ({ chrome }) => useSettingsAutoResize(el, chrome, 0),
      { initialProps: { chrome: CHROME } },
    );
    expect(setSizeCallCount()).toBe(1);

    rerender({ chrome: CHROME + 56 });

    expect(setSizeCallCount()).toBe(2);
    expect(lastSize().height).toBe(height + CHROME + 56);
  });

  it('stops resizing after unmount', () => {
    const { unmount } = renderHook(() => useSettingsAutoResize(el, CHROME, 0));
    expect(setSizeCallCount()).toBe(1);

    unmount();
    expect(setSizeCallCount()).toBe(1);
  });
});
