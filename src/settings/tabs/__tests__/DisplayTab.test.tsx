import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { DisplayTab } from '../DisplayTab';
import { invoke } from '../../../testUtils/mocks/tauri';
import { en } from '../../../i18n/en';
import type { RawAppConfig } from '../../types';

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

/** Installs a backend mock and renders the tab. */
function renderTab(
  autoStart: boolean | 'reject' | Promise<boolean> = false,
  options: { toggleFails?: boolean } = {},
) {
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'is_auto_start_enabled_command') {
      if (autoStart === 'reject') throw new Error('schtasks query failed');
      if (autoStart instanceof Promise) return autoStart;
      return autoStart;
    }
    if (
      cmd === 'enable_auto_start_command' ||
      cmd === 'disable_auto_start_command'
    ) {
      if (options.toggleFails) throw new Error('schtasks failed');
      return undefined;
    }
    return undefined;
  });

  return render(<DisplayTab config={RAW} resyncToken={0} onSaved={vi.fn()} />);
}

const startOnBootToggle = () =>
  screen.getByRole('switch', { name: 'Start on boot' });

describe('DisplayTab start-on-boot', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('loads the enabled state from the OS', async () => {
    renderTab(true);
    await act(async () => {});

    expect(mockInvoke).toHaveBeenCalledWith('is_auto_start_enabled_command');
    expect(startOnBootToggle()).toHaveAttribute('aria-checked', 'true');
  });

  it('loads the disabled state from the OS', async () => {
    renderTab(false);
    await act(async () => {});

    expect(startOnBootToggle()).toHaveAttribute('aria-checked', 'false');
  });

  it('registers the startup task when switched on', async () => {
    renderTab(false);
    await act(async () => {});

    await act(async () => {
      fireEvent.click(startOnBootToggle());
    });

    expect(mockInvoke).toHaveBeenCalledWith('enable_auto_start_command');
    expect(startOnBootToggle()).toHaveAttribute('aria-checked', 'true');
  });

  it('removes the startup task when switched off', async () => {
    renderTab(true);
    await act(async () => {});

    await act(async () => {
      fireEvent.click(startOnBootToggle());
    });

    expect(mockInvoke).toHaveBeenCalledWith('disable_auto_start_command');
    expect(startOnBootToggle()).toHaveAttribute('aria-checked', 'false');
  });

  it('surfaces a localized error and leaves the switch unchanged', async () => {
    renderTab(false, { toggleFails: true });
    await act(async () => {});

    await act(async () => {
      fireEvent.click(startOnBootToggle());
    });

    expect(mockInvoke).toHaveBeenCalledWith('enable_auto_start_command');
    expect(startOnBootToggle()).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('alert')).toHaveTextContent(
      en['settings.display.startOnBootError'],
    );
  });

  it('clears the error after a later successful toggle', async () => {
    renderTab(false, { toggleFails: true });
    await act(async () => {});
    await act(async () => {
      fireEvent.click(startOnBootToggle());
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'is_auto_start_enabled_command') return false;
      return undefined;
    });
    await act(async () => {
      fireEvent.click(startOnBootToggle());
    });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(startOnBootToggle()).toHaveAttribute('aria-checked', 'true');
  });

  it('falls back to disabled when the OS query fails', async () => {
    renderTab('reject');
    await act(async () => {});

    expect(startOnBootToggle()).toHaveAttribute('aria-checked', 'false');
  });

  it('ignores an enabled state that lands after unmount', async () => {
    const d = deferred<boolean>();
    const { unmount } = renderTab(d.promise);
    unmount();

    await act(async () => {
      d.resolve(true);
    });

    expect(screen.queryByRole('switch', { name: 'Start on boot' })).toBeNull();
  });

  it('ignores a query failure that lands after unmount', async () => {
    const d = deferred<boolean>();
    const { unmount } = renderTab(d.promise);
    unmount();

    await act(async () => {
      d.reject(new Error('late'));
    });

    expect(screen.queryByRole('switch', { name: 'Start on boot' })).toBeNull();
  });
});
