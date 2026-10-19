import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { SettingsWindow } from '../SettingsWindow';
import { invoke } from '../../testUtils/mocks/tauri';
import { __mockWindow } from '../../testUtils/mocks/tauri-window';
import { LANGUAGE_STORAGE_KEY, setLocale } from '../../i18n';
import { en } from '../../i18n/en';

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

const RAW = {
  general: { hotkey: 'ctrl', language: 'auto', data_dir: '', theme: 'dark' },
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

/** Installs a mock invoke that echoes config edits back like the backend. */
function installBackend(
  options: {
    marker?: unknown;
    settings?: Record<string, string>;
    settingsError?: boolean;
    testConnection?: unknown;
  } = {},
) {
  let state = structuredClone(RAW);
  mockInvoke.mockImplementation(
    async (cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case 'get_config':
        case 'reload_config_from_disk':
          return state;
        case 'reset_config':
          state = structuredClone(RAW);
          return state;
        case 'set_config_field': {
          const section = args?.section as keyof typeof RAW;
          const key = args?.key as string;
          state = {
            ...state,
            [section]: { ...state[section], [key]: args?.value },
          };
          return state;
        }
        case 'get_settings':
          if (options.settingsError) throw new Error('db locked');
          return options.settings ?? {};
        case 'get_corrupt_marker':
          return options.marker ?? null;
        case 'get_skills':
          return [];
        case 'get_default_data_dir':
          return 'C:\\Users\\me\\AppData\\Roaming\\quickai';
        case 'test_connection':
          return options.testConnection;
        default:
          return undefined;
      }
    },
  );
}

async function renderWindow(
  options: {
    marker?: unknown;
    settings?: Record<string, string>;
    settingsError?: boolean;
    testConnection?: unknown;
  } = {},
) {
  installBackend(options);
  const view = render(<SettingsWindow />);
  await act(async () => {});
  return view;
}

function tab(name: string) {
  return screen.getByRole('tab', { name });
}

/** Switches to a tab and flushes the async effects it mounts. */
async function goToTab(name: string) {
  fireEvent.click(tab(name));
  await act(async () => {});
}

async function flushDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
}

/** How many times `cmd` has been invoked since the mock was reset. */
function countCalls(cmd: string): number {
  return mockInvoke.mock.calls.filter((call) => call[0] === cmd).length;
}

describe('SettingsWindow', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    setLocale('en');
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    __mockWindow.setSize.mockClear();
    __mockWindow.hide.mockClear();
    __mockWindow.setFocus.mockClear();
    __mockWindow.startDragging.mockClear();
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing until the config resolves', () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    const { container } = render(<SettingsWindow />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the five tabs, starting on General', async () => {
    await renderWindow();
    expect(tab('General')).toHaveAttribute('aria-selected', 'true');
    expect(tab('AI')).toBeInTheDocument();
    expect(tab('Display')).toBeInTheDocument();
    expect(tab('Agent')).toBeInTheDocument();
    expect(tab('About')).toBeInTheDocument();
    expect(
      screen.getByRole('tablist', { name: 'Settings sections' }),
    ).toBeInTheDocument();
  });

  it('switches tabs on click', async () => {
    await renderWindow();

    await goToTab('AI');
    expect(screen.getByText('Chat model')).toBeInTheDocument();

    await goToTab('Display');
    expect(screen.getByText('Overlay width')).toBeInTheDocument();

    await goToTab('Agent');
    expect(screen.getByText('Agent permissions')).toBeInTheDocument();

    await goToTab('About');
    expect(screen.getByText('Refresh config.toml')).toBeInTheDocument();
  });

  it('navigates tabs with the arrow keys and ignores other keys', async () => {
    await renderWindow();

    fireEvent.keyDown(tab('General'), { key: 'ArrowRight' });
    expect(tab('AI')).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(tab('AI'), { key: 'ArrowLeft' });
    expect(tab('General')).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(tab('General'), { key: 'ArrowLeft' });
    expect(tab('About')).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(tab('About'), { key: 'a' });
    expect(tab('About')).toHaveAttribute('aria-selected', 'true');
  });

  it('sizes the window once to the fixed Settings size', async () => {
    await renderWindow();
    expect(__mockWindow.setSize).toHaveBeenCalledTimes(1);
    expect(__mockWindow.setSize).toHaveBeenCalledWith({
      width: 580,
      height: 700,
    });

    // Switching tabs must not resize the window again.
    await goToTab('AI');
    await goToTab('Display');
    expect(__mockWindow.setSize).toHaveBeenCalledTimes(1);
  });

  it('hides the window from the close button and Ctrl+W, and focuses on Ctrl+,', async () => {
    await renderWindow();

    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(__mockWindow.hide).toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'w', ctrlKey: true });
    expect(__mockWindow.hide).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(document, { key: ',', ctrlKey: true });
    expect(__mockWindow.setFocus).toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'x', ctrlKey: true });
    expect(__mockWindow.setFocus).toHaveBeenCalledTimes(1);
  });

  it('starts a window drag only from the non-scrolling chrome', async () => {
    await renderWindow();
    const closeButton = screen.getByRole('button', { name: 'Close settings' });
    const closeRow = closeButton.parentElement as HTMLElement;

    fireEvent.mouseDown(closeRow, { button: 0 });
    expect(__mockWindow.startDragging).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(screen.getByRole('tablist'), { button: 0 });
    expect(__mockWindow.startDragging).toHaveBeenCalledTimes(2);

    // Right-click never drags.
    fireEvent.mouseDown(closeRow, { button: 2 });
    fireEvent.mouseDown(screen.getByRole('tablist'), { button: 2 });
    expect(__mockWindow.startDragging).toHaveBeenCalledTimes(2);

    // Interactive controls never drag.
    fireEvent.mouseDown(closeButton);
    fireEvent.mouseDown(tab('General'));
    expect(__mockWindow.startDragging).toHaveBeenCalledTimes(2);

    // The scrollable body — and therefore its scrollbar — never drags.
    fireEvent.mouseDown(screen.getByRole('tabpanel'));
    expect(__mockWindow.startDragging).toHaveBeenCalledTimes(2);

    // A dialog backdrop covers the window; pressing it must not drag either.
    fireEvent.click(tab('About'));
    fireEvent.mouseDown(screen.getByRole('tabpanel'));
    expect(__mockWindow.startDragging).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(__mockWindow.startDragging).toHaveBeenCalledTimes(2);
  });

  it('shows the corrupt-config banner and supports reveal and dismiss', async () => {
    await renderWindow({
      marker: {
        path: 'C:\\Users\\me\\.config\\quickai\\config.toml.bak',
        ts: 1,
      },
    });

    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('config.toml.bak');

    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(mockInvoke).toHaveBeenCalledWith('reveal_config_in_explorer');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hides the corrupt-config banner when no marker is returned', async () => {
    await renderWindow();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shortens a POSIX marker path', async () => {
    await renderWindow({
      marker: { path: '/home/me/.config/quickai/config.toml.bak', ts: 1 },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('config.toml.bak');
  });

  it('handles a marker path with no separator at all', async () => {
    await renderWindow({ marker: { path: 'config.toml.bak', ts: 1 } });
    expect(screen.getByRole('alert')).toHaveTextContent('config.toml.bak');
  });

  it('shows the saved pill briefly after a config change', async () => {
    await renderWindow();

    fireEvent.click(tab('About'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Reset all to defaults...' }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    });

    expect(screen.getByRole('status').className).toContain('Visible');

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByRole('status').className).not.toContain('Visible');
  });

  describe('tab switching (keep-alive)', () => {
    it('does not re-run a tab mount effect when the tab is revisited', async () => {
      await renderWindow();
      await goToTab('AI');
      expect(countCalls('get_skills')).toBe(1);
      expect(countCalls('get_settings')).toBe(1);

      // Fast switching between two tabs must not re-fetch anything.
      await goToTab('Display');
      await goToTab('AI');
      await goToTab('Display');
      await goToTab('AI');

      expect(countCalls('get_skills')).toBe(1);
      expect(countCalls('get_settings')).toBe(1);
    });

    it('does not re-query the OS when General is revisited', async () => {
      await renderWindow();
      await act(async () => {});
      expect(countCalls('is_auto_start_enabled_command')).toBe(1);
      expect(countCalls('get_default_data_dir')).toBe(1);

      await goToTab('AI');
      await goToTab('General');
      await goToTab('AI');
      await goToTab('General');

      // `is_auto_start_enabled_command` spawns a `schtasks` process; re-running
      // it on every switch was the measured cost of item 3.
      expect(countCalls('is_auto_start_enabled_command')).toBe(1);
      expect(countCalls('get_default_data_dir')).toBe(1);
    });

    it('mounts a tab only once it has been opened', async () => {
      await renderWindow();
      expect(screen.queryByText('Chat model')).toBeNull();

      await goToTab('AI');
      await goToTab('Display');

      // AI stays mounted after leaving it; Agent was never opened.
      expect(screen.getByText('Chat model')).toBeInTheDocument();
      expect(screen.queryByText('Agent permissions')).toBeNull();
    });

    it('exposes only the active panel to role queries', async () => {
      await renderWindow();
      await goToTab('AI');
      await goToTab('Display');

      const panels = screen.getAllByRole('tabpanel');
      expect(panels).toHaveLength(1);
      expect(panels[0]).toHaveAttribute('id', 'panel-display');
    });
  });

  describe('General tab', () => {
    it('saves the summon hotkey', async () => {
      await renderWindow();

      fireEvent.change(
        screen.getByLabelText('Summon hotkey', { selector: 'select' }),
        { target: { value: 'alt' } },
      );
      await flushDebounce();

      expect(mockInvoke).toHaveBeenCalledWith('set_config_field', {
        section: 'general',
        key: 'hotkey',
        value: 'alt',
      });
    });

    it('persists the interface language', async () => {
      await renderWindow();

      const select = screen.getByLabelText('Interface language', {
        selector: 'select',
      });
      expect(select).toHaveValue('auto');

      fireEvent.change(select, { target: { value: 'zh' } });

      expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('zh');
      expect(document.documentElement.lang).toBe('zh');

      await flushDebounce();
      expect(mockInvoke).toHaveBeenCalledWith('set_config_field', {
        section: 'general',
        key: 'language',
        value: 'zh',
      });
      setLocale('en');
    });

    it('saves the data directory', async () => {
      await renderWindow();

      fireEvent.change(
        screen.getByLabelText('Data directory', { selector: 'input' }),
        { target: { value: 'D:\\QuickAI' } },
      );
      await flushDebounce();

      expect(mockInvoke).toHaveBeenCalledWith('set_config_field', {
        section: 'general',
        key: 'data_dir',
        value: 'D:\\QuickAI',
      });
    });
  });

  describe('AI tab', () => {
    it('starts the model field empty with a placeholder', async () => {
      await renderWindow();
      await goToTab('AI');

      const model = screen.getByLabelText('Chat model', { selector: 'input' });
      expect(model).toHaveValue('');
      expect(model).toHaveAttribute(
        'placeholder',
        en['settings.ai.modelPlaceholder'],
      );
    });

    it('loads and saves the API key for the active provider', async () => {
      await renderWindow({ settings: { api_key_openai: 'sk-openai' } });
      await goToTab('AI');

      const keyInput = screen.getByLabelText('API Key (OpenAI)', {
        selector: 'input',
      });
      expect(keyInput).toHaveValue('sk-openai');

      fireEvent.change(keyInput, { target: { value: 'sk-new' } });
      await act(async () => {
        fireEvent.blur(keyInput);
      });
      expect(mockInvoke).toHaveBeenCalledWith('set_setting', {
        key: 'api_key_openai',
        value: 'sk-new',
      });
    });

    it('reloads the API key when the provider changes', async () => {
      await renderWindow({
        settings: { api_key_openai: 'sk-openai', api_key_anthropic: 'sk-ant' },
      });
      await goToTab('AI');

      fireEvent.change(
        screen.getByLabelText('Chat provider', { selector: 'select' }),
        {
          target: { value: 'anthropic' },
        },
      );
      await flushDebounce();

      expect(mockInvoke).toHaveBeenCalledWith('set_config_field', {
        section: 'chat',
        key: 'provider',
        value: 'anthropic',
      });
      expect(
        screen.getByLabelText('API Key (Anthropic)', { selector: 'input' }),
      ).toHaveValue('sk-ant');
    });

    it('saves the model and base URL', async () => {
      await renderWindow();
      await goToTab('AI');

      fireEvent.change(
        screen.getByLabelText('Chat model', { selector: 'input' }),
        {
          target: { value: 'o4-mini' },
        },
      );
      await flushDebounce();
      expect(mockInvoke).toHaveBeenCalledWith('set_config_field', {
        section: 'chat',
        key: 'model',
        value: 'o4-mini',
      });

      fireEvent.change(
        screen.getByLabelText('Base URL', { selector: 'input' }),
        {
          target: { value: 'https://proxy.example/v1' },
        },
      );
      await flushDebounce();
      expect(mockInvoke).toHaveBeenCalledWith('set_config_field', {
        section: 'chat',
        key: 'base_url',
        value: 'https://proxy.example/v1',
      });
    });

    it('replaces the system-prompt field with the Skills section', async () => {
      await renderWindow();
      await goToTab('AI');

      expect(screen.queryByLabelText('System prompt')).toBeNull();
      expect(screen.getByText('Skills')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Add skill' }),
      ).toBeInTheDocument();
    });

    it('shows the connection status control, untested by default', async () => {
      await renderWindow();
      await goToTab('AI');

      expect(
        screen.getByRole('status', { name: 'Connection status' }),
      ).toHaveTextContent('Not yet tested');
      expect(
        screen.getByRole('button', { name: 'Test connection' }),
      ).toBeInTheDocument();
    });

    it('keeps a connection verdict across tab switches', async () => {
      await renderWindow({ testConnection: { status: 'success' } });
      await goToTab('AI');

      fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
      await act(async () => {});
      expect(
        screen.getByRole('status', { name: 'Connection status' }),
      ).toHaveTextContent('Connected');

      // The panel stays mounted, so its verdict survives leaving the tab.
      await goToTab('Display');
      await goToTab('AI');
      expect(
        screen.getByRole('status', { name: 'Connection status' }),
      ).toHaveTextContent('Connected');
    });

    it('ignores an API-key result that lands after unmount', async () => {
      let resolveSettings!: (value: Record<string, string>) => void;
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'get_config' || cmd === 'reload_config_from_disk') {
          return Promise.resolve(RAW);
        }
        if (cmd === 'get_skills') return Promise.resolve([]);
        if (cmd === 'get_settings') {
          return new Promise<Record<string, string>>((res) => {
            resolveSettings = res;
          });
        }
        return Promise.resolve(undefined);
      });

      const { unmount } = render(<SettingsWindow />);
      await act(async () => {});
      await goToTab('AI');
      unmount();

      await act(async () => {
        resolveSettings({ api_key_openai: 'sk-late' });
      });

      expect(screen.queryByLabelText('API Key (OpenAI)')).toBeNull();
    });

    it('tolerates a failing API-key lookup', async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'get_config' || cmd === 'reload_config_from_disk')
          return RAW;
        if (cmd === 'get_settings') throw new Error('db locked');
        if (cmd === 'get_skills') return [];
        return undefined;
      });
      render(<SettingsWindow />);
      await act(async () => {});
      await goToTab('AI');

      expect(
        screen.getByLabelText('API Key (OpenAI)', { selector: 'input' }),
      ).toHaveValue('');
    });

    it('ignores a failing API-key save', async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'get_config' || cmd === 'reload_config_from_disk')
          return RAW;
        if (cmd === 'get_settings') return {};
        if (cmd === 'get_skills') return [];
        if (cmd === 'set_setting') throw new Error('db locked');
        return undefined;
      });
      render(<SettingsWindow />);
      await act(async () => {});
      await goToTab('AI');

      const input = screen.getByLabelText('API Key (OpenAI)', {
        selector: 'input',
      });
      fireEvent.change(input, { target: { value: 'sk-x' } });
      await act(async () => {
        fireEvent.blur(input);
      });

      expect(mockInvoke).toHaveBeenCalledWith('set_setting', {
        key: 'api_key_openai',
        value: 'sk-x',
      });
    });
  });

  describe('Display tab', () => {
    it('saves window and quote limits', async () => {
      await renderWindow();
      fireEvent.click(tab('Display'));

      const width = screen.getByLabelText('Overlay width', {
        selector: 'input',
      });
      fireEvent.change(width, { target: { value: '800' } });
      fireEvent.mouseUp(width);
      await flushDebounce();
      expect(mockInvoke).toHaveBeenCalledWith('set_config_field', {
        section: 'window',
        key: 'overlay_width',
        value: 800,
      });

      const maxImages = screen.getByRole('spinbutton', { name: 'Max images' });
      fireEvent.click(
        within(maxImages).getByRole('button', { name: 'Increase' }),
      );
      await flushDebounce();
      expect(mockInvoke).toHaveBeenCalledWith('set_config_field', {
        section: 'window',
        key: 'max_images',
        value: 4,
      });
    });
  });

  describe('Agent tab', () => {
    it('shows the chat configuration while in same-as-AI mode', async () => {
      await renderWindow();
      await goToTab('Agent');

      expect(
        screen.getByText('Uses your AI configuration'),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText('Agent model')).toBeNull();
      expect(screen.queryByLabelText('Agent provider')).toBeNull();
    });

    it('reveals the agent fields in custom mode', async () => {
      await renderWindow({ settings: { api_key_openai: 'sk-agent' } });
      await goToTab('Agent');

      fireEvent.change(
        screen.getByLabelText('Configuration', { selector: 'select' }),
        { target: { value: 'custom' } },
      );
      await flushDebounce();
      await act(async () => {});

      expect(
        screen.getByLabelText('Agent model', { selector: 'input' }),
      ).toHaveValue('');
      expect(
        screen.getByLabelText('API Key (OpenAI)', { selector: 'input' }),
      ).toHaveValue('sk-agent');

      fireEvent.change(
        screen.getByLabelText('Agent model', { selector: 'input' }),
        { target: { value: 'gpt-4.1' } },
      );
      await flushDebounce();
      expect(mockInvoke).toHaveBeenCalledWith('set_config_field', {
        section: 'agent',
        key: 'model',
        value: 'gpt-4.1',
      });

      fireEvent.change(
        screen.getByLabelText('Agent provider', { selector: 'select' }),
        { target: { value: 'openai_compatible' } },
      );
      await flushDebounce();
      expect(mockInvoke).toHaveBeenCalledWith('set_config_field', {
        section: 'agent',
        key: 'provider',
        value: 'openai_compatible',
      });
    });

    it('tolerates a failing agent key lookup in custom mode', async () => {
      await renderWindow({ settingsError: true });
      await goToTab('Agent');

      fireEvent.change(
        screen.getByLabelText('Configuration', { selector: 'select' }),
        { target: { value: 'custom' } },
      );
      await flushDebounce();
      await act(async () => {});

      expect(
        screen.getByLabelText('API Key (OpenAI)', { selector: 'input' }),
      ).toHaveValue('');
    });

    it('warns when full agent permissions are selected', async () => {
      await renderWindow();
      await goToTab('Agent');

      const select = screen.getByLabelText('Agent permissions', {
        selector: 'select',
      });
      expect(select).toHaveValue('limited');

      fireEvent.change(select, { target: { value: 'full' } });
      expect(screen.getByRole('alert')).toHaveTextContent(
        en['settings.agent.permissionWarning'],
      );

      await flushDebounce();
      expect(mockInvoke).toHaveBeenCalledWith('set_config_field', {
        section: 'agent',
        key: 'permission',
        value: 'full',
      });
    });

    it('saves the agent API key in custom mode and ignores a failure', async () => {
      await renderWindow({ settings: { api_key_openai: 'sk-agent' } });
      await goToTab('Agent');
      fireEvent.change(
        screen.getByLabelText('Configuration', { selector: 'select' }),
        { target: { value: 'custom' } },
      );
      await flushDebounce();
      await act(async () => {});

      const input = screen.getByLabelText('API Key (OpenAI)', {
        selector: 'input',
      });
      fireEvent.change(input, { target: { value: 'sk-agent-2' } });
      await act(async () => {
        fireEvent.blur(input);
      });
      expect(mockInvoke).toHaveBeenCalledWith('set_setting', {
        key: 'api_key_openai',
        value: 'sk-agent-2',
      });

      // A failing save must be swallowed.
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'set_setting') throw new Error('db locked');
        return undefined;
      });
      fireEvent.change(input, { target: { value: 'sk-agent-3' } });
      await act(async () => {
        fireEvent.blur(input);
      });
      expect(
        screen.getByLabelText('API Key (OpenAI)', { selector: 'input' }),
      ).toHaveValue('sk-agent-3');
    });
  });

  describe('About tab', () => {
    it('opens the shortcuts and help popups from compact rows', async () => {
      await renderWindow();
      fireEvent.click(tab('About'));

      // The long reference content lives in dialogs, not on the page. (The
      // General tab stays mounted but hidden, so scope to the active panel.)
      expect(
        within(screen.getByRole('tabpanel')).queryByText('Double-tap Ctrl'),
      ).toBeNull();

      fireEvent.click(
        screen.getByRole('button', { name: 'Shortcuts and commands' }),
      );
      const shortcuts = screen.getByRole('dialog');
      expect(
        within(shortcuts).getByText('Double-tap Ctrl'),
      ).toBeInTheDocument();
      expect(within(shortcuts).getByText('Ctrl+S')).toBeInTheDocument();
      expect(within(shortcuts).getByText('/screen')).toBeInTheDocument();

      fireEvent.click(within(shortcuts).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Help' }));
      expect(
        within(screen.getByRole('dialog')).getByText(
          en['about.help.trayTitle'],
        ),
      ).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByText(en['about.help.trayTitle'])).toBeNull();
    });

    it('opens links and file actions', async () => {
      await renderWindow();
      fireEvent.click(tab('About'));

      fireEvent.click(screen.getByRole('button', { name: /release notes/i }));
      expect(mockInvoke).toHaveBeenCalledWith('open_url', {
        url: expect.stringContaining('/releases/tag/v'),
      });

      fireEvent.click(
        screen.getByRole('button', { name: 'View QuickAI on GitHub' }),
      );
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Open an issue or share feedback on GitHub',
        }),
      );
      expect(mockInvoke).toHaveBeenCalledWith('open_url', {
        url: 'https://github.com/yorelll/quickai',
      });

      fireEvent.click(
        screen.getByRole('button', { name: 'Reveal QuickAI app data' }),
      );
      expect(mockInvoke).toHaveBeenCalledWith('reveal_config_in_explorer');

      fireEvent.click(
        screen.getByRole('button', { name: 'Refresh config.toml' }),
      );
      expect(mockInvoke).toHaveBeenCalledWith('reload_config_from_disk');
    });

    it('cancels the reset confirmation', async () => {
      await renderWindow();
      fireEvent.click(tab('About'));

      fireEvent.click(
        screen.getByRole('button', { name: 'Reset all to defaults...' }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(mockInvoke).not.toHaveBeenCalledWith('reset_config', {
        section: null,
      });
    });

    it('shows a nightly version when a commit sha is baked in', async () => {
      vi.stubEnv('VITE_GIT_COMMIT_SHA', 'abc1234def5678');
      try {
        await renderWindow();
        fireEvent.click(tab('About'));
        expect(screen.getByText(/\+nightly\.abc1234/)).toBeInTheDocument();
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
