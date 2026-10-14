import { describe, it, expect } from 'vitest';
import { HOTKEYS, normalizeHotkey, hotkeyLabelKey } from '../hotkeys';
import { en } from '../../i18n/en';
import { zh } from '../../i18n/zh';

describe('hotkeys', () => {
  it('lists the supported double-tap keys', () => {
    expect(HOTKEYS).toEqual(['ctrl', 'alt', 'shift', 'win']);
  });

  it('keeps a known hotkey and falls back to Ctrl', () => {
    expect(normalizeHotkey('alt')).toBe('alt');
    expect(normalizeHotkey('win')).toBe('win');
    expect(normalizeHotkey('bogus')).toBe('ctrl');
  });

  it('resolves a localized label for every hotkey', () => {
    for (const hotkey of HOTKEYS) {
      const key = hotkeyLabelKey(hotkey);
      expect(en[key]).toBeTruthy();
      expect(zh[key]).toBeTruthy();
    }
  });
});
