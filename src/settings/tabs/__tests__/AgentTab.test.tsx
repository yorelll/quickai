import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AgentTab } from '../AgentTab';
import { invoke } from '../../../testUtils/mocks/tauri';
import type { RawAppConfig } from '../../types';

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

const CUSTOM: RawAppConfig = {
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
    mode: 'custom',
    provider: 'openai',
    model: '',
    base_url: '',
    permission: 'limited',
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('AgentTab custom-mode API key', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('leaves the key empty when the provider has none stored', async () => {
    mockInvoke.mockImplementation(async (cmd: string) =>
      cmd === 'get_settings' ? {} : undefined,
    );

    render(<AgentTab config={CUSTOM} resyncToken={0} onSaved={vi.fn()} />);
    await act(async () => {});

    expect(
      screen.getByLabelText('API Key (OpenAI)', { selector: 'input' }),
    ).toHaveValue('');
  });

  it('ignores a key that resolves after unmount', async () => {
    const pending = deferred<Record<string, string>>();
    mockInvoke.mockImplementation(async (cmd: string) =>
      cmd === 'get_settings' ? pending.promise : undefined,
    );

    const { unmount } = render(
      <AgentTab config={CUSTOM} resyncToken={0} onSaved={vi.fn()} />,
    );
    unmount();

    await act(async () => {
      pending.resolve({ api_key_openai: 'sk-late' });
    });

    expect(
      screen.queryByLabelText('API Key (OpenAI)', { selector: 'input' }),
    ).toBeNull();
  });
});
