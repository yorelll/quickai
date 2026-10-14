import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { GeneralTab } from '../GeneralTab';
import { invoke } from '../../../testUtils/mocks/tauri';
import { LANGUAGE_STORAGE_KEY, setLocale } from '../../../i18n';
import type { RawAppConfig } from '../../types';

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

const RAW: RawAppConfig = {
  general: { hotkey: 'ctrl', language: 'auto', data_dir: '' },
  prompt: { system: '' },
  window: { overlay_width: 600, max_chat_height: 648, max_images: 3 },
  quote: {
    max_display_lines: 4,
    max_display_chars: 300,
    max_context_length: 4096,
  },
  chat: { provider: 'openai', model: '', base_url: '' },
  agent: {
    mode: 'same_as_chat',
    provider: 'openai',
    model: '',
    base_url: '',
    permission: 'limited',
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Installs a backend mock that echoes config edits back like the backend. */
function installBackend(
  autoStart: boolean | 'reject' | Promise<boolean> = false,
  options: { toggleFails?: boolean } = {},
) {
  mockInvoke.mockImplementation(
    async (cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case 'is_auto_start_enabled_command':
          if (autoStart === 'reject') throw new Error('schtasks query failed');
          if (autoStart instanceof Promise) return autoStart;
          return autoStart;
        case 'enable_auto_start_command':
        case 'disable_auto_start_command':
          if (options.toggleFails) throw new Error('schtasks failed');
          return undefined;
        case 'set_config_field': {
          const section = args?.section as keyof typeof RAW;
          const key = args?.key as string;
          return {
            ...RAW,
            [section]: { ...RAW[section], [key]: args?.value },
          };
        }
        default:
          return undefined;
      }
    },
  );
}

function renderTab(
  config: RawAppConfig = RAW,
  autoStart: boolean | 'reject' | Promise<boolean> = false,
  options: { toggleFails?: boolean } = {},
) {
  installBackend(autoStart, options);
  return render(
    <GeneralTab config={config} resyncToken={0} onSaved={vi.fn()} />,
  );
}

async function flushDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
}

const startOnBootToggle = () =>
  screen.getByRole('switch', { name: 'Start on boot' });

describe('GeneralTab', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    setLocale('en');
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    setLocale('en');
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  });

  it('renders the hotkey, language and data-directory controls', () => {
    renderTab();
    expect(
      screen.getByLabelText('Summon hotkey', { selector: 'select' }),
    ).toHaveValue('ctrl');
    expect(
      screen.getByLabelText('Interface language', { selector: 'select' }),
    ).toHaveValue('auto');
    expect(
      screen.getByLabelText('Data directory', { selector: 'input' }),
    ).toHaveValue('');
  });

  it('saves the summon hotkey', async () => {
    renderTab();
    fireEvent.change(
      screen.getByLabelText('Summon hotkey', { selector: 'select' }),
      {
        target: { value: 'alt' },
      },
    );
    await flushDebounce();

    expect(mockInvoke).toHaveBeenCalledWith('set_config_field', {
      section: 'general',
      key: 'hotkey',
      value: 'alt',
    });
  });

  it('saves the interface language and applies it immediately', async () => {
    renderTab();
    fireEvent.change(
      screen.getByLabelText('Interface language', { selector: 'select' }),
      { target: { value: 'zh' } },
    );

    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('zh');
    expect(document.documentElement.lang).toBe('zh');

    await flushDebounce();
    expect(mockInvoke).toHaveBeenCalledWith('set_config_field', {
      section: 'general',
      key: 'language',
      value: 'zh',
    });
  });

  it('adopts the config language on mount when nothing is persisted', () => {
    renderTab({
      ...RAW,
      general: { ...RAW.general, language: 'zh' },
    });

    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('zh');
    expect(document.documentElement.lang).toBe('zh');
  });

  it('keeps an explicit persisted choice over the config language', () => {
    setLocale('en');

    renderTab({
      ...RAW,
      general: { ...RAW.general, language: 'zh' },
    });

    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('falls back to auto for an unknown persisted language', () => {
    renderTab({
      ...RAW,
      general: { ...RAW.general, language: 'klingon' },
    });

    expect(
      screen.getByLabelText('Interface language', { selector: 'select' }),
    ).toHaveValue('auto');
  });

  it('saves the data directory', async () => {
    renderTab();
    fireEvent.change(
      screen.getByLabelText('Data directory', { selector: 'input' }),
      {
        target: { value: 'D:\\QuickAI' },
      },
    );
    await flushDebounce();

    expect(mockInvoke).toHaveBeenCalledWith('set_config_field', {
      section: 'general',
      key: 'data_dir',
      value: 'D:\\QuickAI',
    });
  });

  describe('start-on-boot', () => {
    it('loads the enabled state from the OS', async () => {
      renderTab(RAW, true);
      await act(async () => {});

      expect(mockInvoke).toHaveBeenCalledWith('is_auto_start_enabled_command');
      expect(startOnBootToggle()).toHaveAttribute('aria-checked', 'true');
    });

    it('loads the disabled state from the OS', async () => {
      renderTab(RAW, false);
      await act(async () => {});

      expect(startOnBootToggle()).toHaveAttribute('aria-checked', 'false');
    });

    it('registers the startup task when switched on', async () => {
      renderTab(RAW, false);
      await act(async () => {});

      await act(async () => {
        fireEvent.click(startOnBootToggle());
      });

      expect(mockInvoke).toHaveBeenCalledWith('enable_auto_start_command');
      expect(startOnBootToggle()).toHaveAttribute('aria-checked', 'true');
    });

    it('removes the startup task when switched off', async () => {
      renderTab(RAW, true);
      await act(async () => {});

      await act(async () => {
        fireEvent.click(startOnBootToggle());
      });

      expect(mockInvoke).toHaveBeenCalledWith('disable_auto_start_command');
      expect(startOnBootToggle()).toHaveAttribute('aria-checked', 'false');
    });

    it('surfaces a localized error and leaves the switch unchanged', async () => {
      renderTab(RAW, false, { toggleFails: true });
      await act(async () => {});

      await act(async () => {
        fireEvent.click(startOnBootToggle());
      });

      expect(mockInvoke).toHaveBeenCalledWith('enable_auto_start_command');
      expect(startOnBootToggle()).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Couldn't update the start-on-boot setting.",
      );
    });

    it('clears the error after a later successful toggle', async () => {
      renderTab(RAW, false, { toggleFails: true });
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
      renderTab(RAW, 'reject');
      await act(async () => {});

      expect(startOnBootToggle()).toHaveAttribute('aria-checked', 'false');
    });

    it('ignores an enabled state that lands after unmount', async () => {
      const d = deferred<boolean>();
      const { unmount } = renderTab(RAW, d.promise);
      unmount();

      await act(async () => {
        d.resolve(true);
      });

      expect(
        screen.queryByRole('switch', { name: 'Start on boot' }),
      ).toBeNull();
    });

    it('ignores a query failure that lands after unmount', async () => {
      const d = deferred<boolean>();
      const { unmount } = renderTab(RAW, d.promise);
      unmount();

      await act(async () => {
        d.reject(new Error('late'));
      });

      expect(
        screen.queryByRole('switch', { name: 'Start on boot' }),
      ).toBeNull();
    });
  });
});
