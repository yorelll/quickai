import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedSave } from '../useDebouncedSave';
import { invoke } from '../../../testUtils/mocks/tauri';
import type { RawAppConfig } from '../../types';

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

const NEXT = {
  prompt: { system: '' },
  window: { overlay_width: 600, max_chat_height: 648, max_images: 3 },
  quote: {
    max_display_lines: 4,
    max_display_chars: 300,
    max_context_length: 4096,
  },
  chat: { provider: 'openai', model: 'gpt-4o', base_url: '' },
  agent: { provider: 'openai', model: '', base_url: '' },
} as unknown as RawAppConfig;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useDebouncedSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(NEXT);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves the changed value after the debounce delay', async () => {
    const onSaved = vi.fn();
    const { rerender } = renderHook(
      ({ value }) =>
        useDebouncedSave('chat', 'model', value, { onSaved, delayMs: 100 }),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'b' });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(mockInvoke).toHaveBeenCalledWith('set_config_field', {
      section: 'chat',
      key: 'model',
      value: 'b',
    });
    expect(onSaved).toHaveBeenCalledWith(NEXT);
  });

  it('does not save when the value is unchanged', async () => {
    renderHook(() => useDebouncedSave('chat', 'model', 'a', { delayMs: 100 }));
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('works without an onSaved callback', async () => {
    const { rerender } = renderHook(
      ({ value }) => useDebouncedSave('chat', 'model', value, { delayMs: 50 }),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'b' });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('uses the default delay and options when none are given', async () => {
    const { rerender } = renderHook(
      ({ value }) => useDebouncedSave('chat', 'model', value),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'b' });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('replaces a pending timer when the value changes again', async () => {
    const { rerender } = renderHook(
      ({ value }) => useDebouncedSave('chat', 'model', value, { delayMs: 100 }),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'b' });
    rerender({ value: 'c' });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('set_config_field', {
      section: 'chat',
      key: 'model',
      value: 'c',
    });
  });

  it('compares array values by content and length', async () => {
    const { rerender } = renderHook(
      ({ value }) => useDebouncedSave('quote', 'list', value, { delayMs: 50 }),
      { initialProps: { value: [] as string[] } },
    );

    // Same content → no save.
    rerender({ value: [] });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(mockInvoke).not.toHaveBeenCalled();

    // Identical content, different array identity → still no save.
    rerender({ value: ['x'] });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    rerender({ value: ['x'] });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    // Different length → save.
    rerender({ value: ['a'] });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(mockInvoke).toHaveBeenCalledTimes(2);

    // Same length, different item → save.
    rerender({ value: ['b'] });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(mockInvoke).toHaveBeenCalledTimes(3);
  });

  it('treats a non-array value against an array as unequal', async () => {
    const { rerender } = renderHook(
      ({ value }) => useDebouncedSave('quote', 'list', value, { delayMs: 50 }),
      { initialProps: { value: 'a' as unknown as string[] } },
    );

    rerender({ value: ['a'] as unknown as string[] });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('records the backend error when the save fails', async () => {
    mockInvoke.mockRejectedValue({ kind: 'unknown_section', section: 'x' });
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedSave('chat', 'model', value, { delayMs: 50 }),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'b' });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    expect(result.current.error).toEqual({
      kind: 'unknown_section',
      section: 'x',
    });
  });

  it('flushNow saves immediately and cancels the pending timer', async () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedSave('chat', 'model', value, { delayMs: 500 }),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'b' });
    await act(async () => {
      await result.current.flushNow();
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('flushNow with no pending timer still saves', async () => {
    const { result } = renderHook(() =>
      useDebouncedSave('chat', 'model', 'a', { delayMs: 500 }),
    );

    await act(async () => {
      await result.current.flushNow();
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('resetTo cancels the pending save and clears the error', async () => {
    mockInvoke.mockRejectedValue({ kind: 'parse' });
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedSave('chat', 'model', value, { delayMs: 50 }),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'b' });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current.error).toEqual({ kind: 'parse' });

    rerender({ value: 'c' });
    act(() => {
      result.current.resetTo('c');
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.error).toBeNull();
  });

  it('ignores a response that lands after resetTo bumped the epoch', async () => {
    const onSaved = vi.fn();
    const d = deferred<RawAppConfig>();
    mockInvoke.mockReturnValueOnce(d.promise);

    const { result, rerender } = renderHook(
      ({ value }) =>
        useDebouncedSave('chat', 'model', value, { onSaved, delayMs: 50 }),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'b' });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    act(() => {
      result.current.resetTo('c');
    });

    await act(async () => {
      d.resolve(NEXT);
    });

    expect(onSaved).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it('ignores a rejection that lands after resetTo bumped the epoch', async () => {
    const d = deferred<RawAppConfig>();
    mockInvoke.mockReturnValueOnce(d.promise);

    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedSave('chat', 'model', value, { delayMs: 50 }),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'b' });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    act(() => {
      result.current.resetTo('c');
    });

    await act(async () => {
      d.reject(new Error('late'));
    });

    expect(result.current.error).toBeNull();
  });

  it('flushes a pending save on unmount', async () => {
    const { rerender, unmount } = renderHook(
      ({ value }) => useDebouncedSave('chat', 'model', value, { delayMs: 500 }),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'b' });
    unmount();
    await act(async () => {});

    expect(mockInvoke).toHaveBeenCalledWith('set_config_field', {
      section: 'chat',
      key: 'model',
      value: 'b',
    });
  });

  it('does nothing on unmount when no save is pending', async () => {
    const { unmount } = renderHook(() =>
      useDebouncedSave('chat', 'model', 'a', { delayMs: 500 }),
    );
    unmount();
    await act(async () => {});
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('swallows a failure that lands after unmount', async () => {
    const d = deferred<RawAppConfig>();
    mockInvoke.mockReturnValueOnce(d.promise);

    const { rerender, unmount } = renderHook(
      ({ value }) => useDebouncedSave('chat', 'model', value, { delayMs: 50 }),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'b' });
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    unmount();
    await act(async () => {
      d.reject(new Error('late'));
    });
  });
});
