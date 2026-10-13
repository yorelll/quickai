import { describe, it, expect, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { invoke } from '../testUtils/mocks/tauri';

/** Raw config as returned by `get_config`. */
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

describe('settings-main.tsx', () => {
  afterEach(() => {
    const root = document.getElementById('settings-root');
    if (root) document.body.removeChild(root);
  });

  it('mounts the settings window without throwing', async () => {
    invoke.mockImplementation(async (cmd: string) =>
      cmd === 'get_config' ? RAW : undefined,
    );

    const root = document.createElement('div');
    root.id = 'settings-root';
    document.body.appendChild(root);

    await act(async () => {
      await expect(import('../settings-main')).resolves.toBeDefined();
    });
    // The settings window gates its first paint on `get_config`.
    await act(async () => {});

    expect(root.childNodes.length).toBeGreaterThan(0);
    expect(root.textContent).toContain('Chat provider');
  });
});
