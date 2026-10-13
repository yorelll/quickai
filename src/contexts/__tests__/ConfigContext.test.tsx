import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import {
  ConfigProvider,
  ConfigProviderForTest,
  DEFAULT_CONFIG,
  useConfig,
  type AppConfig,
} from '../ConfigContext';
import { invoke, listen, emitTauriEvent } from '../../testUtils/mocks/tauri';

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
const mockListen = listen as unknown as ReturnType<typeof vi.fn>;

/** Raw (snake_case) config payload as returned by the Rust `get_config`. */
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

function rawWithChatModel(model: string) {
  return { ...RAW, chat: { ...RAW.chat, model } };
}

function Probe() {
  const config = useConfig();
  return <span data-testid="model">{config.chat.model}</span>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ConfigProvider', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockListen.mockClear();
  });

  it('hydrates the camelCase config from get_config', async () => {
    mockInvoke.mockResolvedValue(rawWithChatModel('custom-model'));

    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    await act(async () => {});

    expect(screen.getByTestId('model').textContent).toBe('custom-model');
  });

  it('falls back to defaults when get_config returns null', async () => {
    mockInvoke.mockResolvedValue(null);

    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    await act(async () => {});

    expect(screen.getByTestId('model').textContent).toBe(
      DEFAULT_CONFIG.chat.model,
    );
  });

  it('falls back to defaults when get_config rejects', async () => {
    mockInvoke.mockRejectedValue(new Error('ipc down'));

    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    await act(async () => {});

    expect(screen.getByTestId('model').textContent).toBe(
      DEFAULT_CONFIG.chat.model,
    );
  });

  it('re-fetches when the config-updated event fires', async () => {
    mockInvoke.mockResolvedValue(rawWithChatModel('first'));

    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('model').textContent).toBe('first');

    mockInvoke.mockResolvedValue(rawWithChatModel('second'));
    await act(async () => {
      emitTauriEvent('quickai://config-updated', {});
    });

    expect(screen.getByTestId('model').textContent).toBe('second');
  });

  it('keeps the previous config when a refresh returns null', async () => {
    mockInvoke.mockResolvedValue(rawWithChatModel('kept'));

    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    await act(async () => {});

    mockInvoke.mockResolvedValue(null);
    await act(async () => {
      emitTauriEvent('quickai://config-updated', {});
    });

    expect(screen.getByTestId('model').textContent).toBe('kept');
  });

  it('tolerates a refresh failure after mount', async () => {
    mockInvoke.mockResolvedValue(rawWithChatModel('kept'));

    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    await act(async () => {});

    mockInvoke.mockRejectedValue(new Error('nope'));
    await act(async () => {
      emitTauriEvent('quickai://config-updated', {});
    });

    expect(screen.getByTestId('model').textContent).toBe('kept');
  });

  it('ignores a resolve that lands after unmount', async () => {
    const d = deferred<unknown>();
    mockInvoke.mockReturnValue(d.promise);

    const { unmount } = render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    unmount();

    await act(async () => {
      d.resolve(rawWithChatModel('late'));
    });

    expect(screen.queryByTestId('model')).toBeNull();
  });

  it('ignores a rejection that lands after unmount', async () => {
    const d = deferred<unknown>();
    mockInvoke.mockReturnValue(d.promise);

    const { unmount } = render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    unmount();

    await act(async () => {
      d.reject(new Error('late'));
    });

    expect(screen.queryByTestId('model')).toBeNull();
  });

  it('tolerates a missing config-updated event bridge', async () => {
    mockInvoke.mockResolvedValue(rawWithChatModel('bridgeless'));
    mockListen.mockRejectedValueOnce(new Error('no bridge'));

    render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    await act(async () => {});

    expect(screen.getByTestId('model').textContent).toBe('bridgeless');
  });

  it('unsubscribes when the listener resolves after unmount', async () => {
    mockInvoke.mockResolvedValue(rawWithChatModel('early'));
    const d = deferred<() => void>();
    mockListen.mockReturnValueOnce(d.promise);

    const { unmount } = render(
      <ConfigProvider>
        <Probe />
      </ConfigProvider>,
    );
    await act(async () => {});
    unmount();

    const stop = vi.fn();
    await act(async () => {
      d.resolve(stop);
    });

    expect(stop).toHaveBeenCalled();
  });
});

describe('useConfig', () => {
  it('falls back to DEFAULT_CONFIG without a provider', () => {
    render(<Probe />);
    expect(screen.getByTestId('model').textContent).toBe(
      DEFAULT_CONFIG.chat.model,
    );
  });
});

describe('ConfigProviderForTest', () => {
  it('provides a synchronous config without invoking get_config', () => {
    const value: AppConfig = {
      ...DEFAULT_CONFIG,
      chat: { provider: 'anthropic', model: 'claude-sonnet-4-5', baseUrl: '' },
    };

    render(
      <ConfigProviderForTest value={value}>
        <Probe />
      </ConfigProviderForTest>,
    );

    expect(screen.getByTestId('model').textContent).toBe('claude-sonnet-4-5');
  });
});
