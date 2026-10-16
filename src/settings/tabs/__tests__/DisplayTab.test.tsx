import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { DisplayTab } from '../DisplayTab';
import { invoke } from '../../../testUtils/mocks/tauri';
import type { RawAppConfig } from '../../types';

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
} as unknown as RawAppConfig;

function renderTab() {
  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === 'set_config_field') return { ...RAW, ...(args as object) };
    return undefined;
  });
  return render(<DisplayTab config={RAW} resyncToken={0} onSaved={vi.fn()} />);
}

async function flushDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
}

describe('DisplayTab', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the window and quote controls', () => {
    renderTab();
    expect(
      screen.getByLabelText('Overlay width', { selector: 'input' }),
    ).toHaveValue('600');
    expect(
      screen.getByRole('spinbutton', { name: 'Max context length' }),
    ).toBeInTheDocument();
  });

  it('saves the overlay width', async () => {
    renderTab();

    const width = screen.getByLabelText('Overlay width', { selector: 'input' });
    fireEvent.change(width, { target: { value: '800' } });
    fireEvent.mouseUp(width);
    await flushDebounce();

    expect(mockInvoke).toHaveBeenCalledWith('set_config_field', {
      section: 'window',
      key: 'overlay_width',
      value: 800,
    });
  });

  it('saves a quote limit through its stepper', async () => {
    renderTab();

    const stepper = screen.getByRole('spinbutton', {
      name: 'Max context length',
    });
    fireEvent.click(within(stepper).getByRole('button', { name: 'Increase' }));
    await flushDebounce();

    expect(mockInvoke).toHaveBeenCalledWith('set_config_field', {
      section: 'quote',
      key: 'max_context_length',
      value: 4096 + 256,
    });
  });
});
