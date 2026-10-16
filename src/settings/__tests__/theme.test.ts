import { describe, it, expect, beforeEach } from 'vitest';
import { THEMES, applyTheme, normalizeTheme, themeLabelKey } from '../theme';
import { en } from '../../i18n/en';
import { zh } from '../../i18n/zh';

describe('theme', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it('lists the supported themes, dark first', () => {
    expect(THEMES).toEqual(['dark', 'light']);
  });

  it('keeps a known theme and defaults to dark', () => {
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme('dark')).toBe('dark');
    expect(normalizeTheme('sepia')).toBe('dark');
  });

  it('resolves a localized label for every theme', () => {
    for (const theme of THEMES) {
      const key = themeLabelKey(theme);
      expect(en[key]).toBeTruthy();
      expect(zh[key]).toBeTruthy();
    }
  });

  it('writes the theme onto the document root', () => {
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');

    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
