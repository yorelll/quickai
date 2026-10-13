import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConfigSync } from '../useConfigSync';
import { invoke } from '../../../testUtils/mocks/tauri';
import {
  emitFocusChanged,
  __mockWindow,
} from '../../../testUtils/mocks/tauri-window';

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

const RAW = {
  prompt: { system: '' },
  window: { overlay_width: 600, max_chat_height: 648, max_images: 3 },
  quote: {
    max_display_lines: 4,
    max_display_chars: 300,
    max_context_length: 4096,
  },
  chat: { provider: 'openai', model: 'gpt-4o', base_url: '' },
  agent: { provider: 'openai', model: '', base_url: '' },
};

describe('useConfigSync', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('loads the config on mount', async () => {
    mockInvoke.mockResolvedValue(RAW);

    const { result } = renderHook(() => useConfigSync());
    expect(result.current.config).toBeNull();

    await act(async () => {});

    expect(result.current.config?.chat.model).toBe('gpt-4o');
  });

  it('leaves config null when the initial load fails', async () => {
    mockInvoke.mockRejectedValue(new Error('ipc down'));

    const { result } = renderHook(() => useConfigSync());
    await act(async () => {});

    expect(result.current.config).toBeNull();
  });

  it('reloads from disk and ignores a reload failure', async () => {
    mockInvoke.mockResolvedValue(RAW);
    const { result } = renderHook(() => useConfigSync());
    await act(async () => {});

    mockInvoke.mockResolvedValue({
      ...RAW,
      chat: { ...RAW.chat, model: 'claude-sonnet-4-5' },
    });
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.config?.chat.model).toBe('claude-sonnet-4-5');

    mockInvoke.mockRejectedValue(new Error('nope'));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.config?.chat.model).toBe('claude-sonnet-4-5');
  });

  it('reloads when the window regains focus', async () => {
    mockInvoke.mockResolvedValue(RAW);
    const { result } = renderHook(() => useConfigSync());
    await act(async () => {});

    mockInvoke.mockResolvedValue({
      ...RAW,
      chat: { ...RAW.chat, model: 'gpt-4.1' },
    });
    await act(async () => {
      emitFocusChanged(true);
    });

    expect(result.current.config?.chat.model).toBe('gpt-4.1');
  });

  it('does not reload when the window loses focus', async () => {
    mockInvoke.mockResolvedValue(RAW);
    renderHook(() => useConfigSync());
    await act(async () => {});
    mockInvoke.mockClear();

    await act(async () => {
      emitFocusChanged(false);
    });

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('unsubscribes when the focus listener resolves after unmount', async () => {
    mockInvoke.mockResolvedValue(RAW);
    let resolveStop!: (stop: () => void) => void;
    (
      __mockWindow.onFocusChanged as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValueOnce(
      new Promise<() => void>((resolve) => {
        resolveStop = resolve;
      }),
    );

    const { unmount } = renderHook(() => useConfigSync());
    unmount();

    const stop = vi.fn();
    await act(async () => {
      resolveStop(stop);
    });

    expect(stop).toHaveBeenCalled();
  });
});
