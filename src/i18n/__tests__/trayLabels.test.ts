import { beforeEach, describe, it, expect, vi } from 'vitest';
import { emit } from '@tauri-apps/api/event';

import { getLocale, setLocale } from '../index';

describe('tray menu labels', () => {
  // Mock history is not cleared by the global setup, so each case starts clean
  // and asserts the exact number of publishes it causes.
  beforeEach(() => {
    vi.mocked(emit).mockClear();
  });

  it('publishes the labels for the resolved locale and for each change', () => {
    expect(getLocale()).toBe('en');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('tray-menu-labels', {
      settings: 'Settings',
      quit: 'Quit',
    });

    setLocale('zh');
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith('tray-menu-labels', {
      settings: '设置',
      quit: '退出',
    });
  });

  it('ignores a failed publish when there is no tray to label', async () => {
    vi.mocked(emit).mockRejectedValueOnce(new Error('no tray'));
    setLocale('en');
    await Promise.resolve();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenLastCalledWith('tray-menu-labels', {
      settings: 'Settings',
      quit: 'Quit',
    });
  });
});
