import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';

import {
  detectLocale,
  getLanguageSetting,
  getLocale,
  setLanguageSetting,
  setLocale,
  t,
  translate,
  useTranslation,
  LocaleProvider,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGE_SETTINGS,
  SUPPORTED_LOCALES,
} from '../index';
import { en } from '../en';
import { zh } from '../zh';
import { isLanguageSetting, isLocale } from '../locales';
import { COMMANDS } from '../../config/commands';
import { TIPS } from '../../config/tips';

/** jsdom exposes `navigator.language` as a prototype accessor, so replace it. */
function setSystemLanguage(tag: string) {
  Object.defineProperty(window.navigator, 'language', {
    value: tag,
    configurable: true,
  });
}

/** Probe component that surfaces the active locale through the hook. */
function LocaleProbe(): ReactNode {
  const { t: translateKey, locale } = useTranslation();
  return (
    <span data-testid="probe">{`${locale}:${translateKey('app.name')}`}</span>
  );
}

describe('locales', () => {
  it('exposes the supported locale identifiers', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'zh']);
  });

  it('narrows valid and invalid locale values', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('zh')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe('language setting', () => {
  beforeEach(() => {
    setSystemLanguage('en-US');
    setLocale('en');
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  });

  it('lists the supported language settings', () => {
    expect(SUPPORTED_LANGUAGE_SETTINGS).toEqual(['auto', 'en', 'zh']);
  });

  it('narrows valid and invalid language settings', () => {
    expect(isLanguageSetting('auto')).toBe(true);
    expect(isLanguageSetting('en')).toBe(true);
    expect(isLanguageSetting('zh')).toBe(true);
    expect(isLanguageSetting('fr')).toBe(false);
    expect(isLanguageSetting(null)).toBe(false);
  });

  it('reports auto when nothing is persisted', () => {
    expect(getLanguageSetting()).toBe('auto');
  });

  it('reports the persisted locale', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'zh');
    expect(getLanguageSetting()).toBe('zh');
  });

  it('reports auto for a garbage persisted value', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'klingon');
    expect(getLanguageSetting()).toBe('auto');
  });

  it('pins and persists an explicit locale', () => {
    setLanguageSetting('zh');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('zh');
    expect(getLocale()).toBe('zh');
  });

  it('clears the persisted choice and re-detects for auto', () => {
    setLocale('zh');
    setSystemLanguage('fr-FR');

    setLanguageSetting('auto');

    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
    expect(getLocale()).toBe('en');
  });
});

describe('detectLocale', () => {
  beforeEach(() => {
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    setSystemLanguage('en-US');
  });

  it('prefers a persisted choice over the system language', () => {
    setSystemLanguage('zh-CN');
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    expect(detectLocale()).toBe('en');
  });

  it('ignores a garbage persisted value', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'klingon');
    setSystemLanguage('zh-TW');
    expect(detectLocale()).toBe('zh');
  });

  it('detects Simplified Chinese from the system language', () => {
    setSystemLanguage('zh-CN');
    expect(detectLocale()).toBe('zh');
  });

  it('detects Chinese regardless of case', () => {
    setSystemLanguage('ZH');
    expect(detectLocale()).toBe('zh');
  });

  it('falls back to English for any other language', () => {
    setSystemLanguage('fr-FR');
    expect(detectLocale()).toBe('en');
  });
});

describe('translate', () => {
  it('returns the template when no params are supplied', () => {
    expect(translate('en', 'app.name')).toBe('QuickAI');
    expect(translate('en', 'time.minutesAgo')).toBe('{count}m ago');
  });

  it('interpolates named placeholders', () => {
    expect(translate('en', 'time.minutesAgo', { count: 5 })).toBe('5m ago');
    expect(translate('zh', 'time.hoursAgo', { count: 3 })).toBe('3 小时前');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(translate('en', 'time.minutesAgo', {})).toBe('{count}m ago');
  });

  it('interpolates numbers and strings', () => {
    expect(translate('en', 'ask.maxImages', { count: 3 })).toBe('Max 3 images');
  });

  it('leaves templates without placeholders unchanged', () => {
    expect(translate('zh', 'app.name', { unused: 'x' })).toBe('QuickAI');
  });
});

describe('locale store', () => {
  beforeEach(() => {
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    setSystemLanguage('en-US');
    setLocale('en');
  });

  it('getLocale reports the active locale', () => {
    expect(getLocale()).toBe('en');
  });

  it('setLocale persists the choice and swaps the dictionary', () => {
    expect(t('time.justNow')).toBe('just now');

    setLocale('zh');

    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('zh');
    expect(getLocale()).toBe('zh');
    expect(t('time.justNow')).toBe('刚刚');
  });

  it('interpolates through the module-level t', () => {
    expect(t('time.daysAgo', { count: 4 })).toBe('4d ago');
  });
});

describe('useTranslation', () => {
  beforeEach(() => {
    setLocale('en');
  });

  it('returns a bound translator for the active locale', () => {
    const { result } = renderHook(() => useTranslation());
    expect(result.current.locale).toBe('en');
    expect(result.current.t('window.save')).toBe('Save conversation');
  });

  it('re-renders consumers when the language changes', () => {
    const { result } = renderHook(() => useTranslation());

    act(() => {
      result.current.setLocale('zh');
    });

    expect(result.current.locale).toBe('zh');
    expect(result.current.t('window.save')).toBe('保存对话');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('zh');
  });

  it('interpolates parameters in the hook translator', () => {
    const { result } = renderHook(() => useTranslation());
    expect(result.current.t('time.weeksAgo', { count: 2 })).toBe('2w ago');
  });
});

describe('LocaleProvider', () => {
  beforeEach(() => {
    setLocale('en');
  });

  it('renders its children and re-renders them on a locale change', () => {
    render(
      <LocaleProvider>
        <LocaleProbe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('en:QuickAI');

    act(() => {
      setLocale('zh');
    });

    expect(screen.getByTestId('probe').textContent).toBe('zh:QuickAI');
  });
});

describe('dictionary completeness', () => {
  it('defines exactly the same keys in both dictionaries', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it('has no empty translations', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.length, `en.${key}`).toBeGreaterThan(0);
    }
    for (const [key, value] of Object.entries(zh)) {
      expect(value.length, `zh.${key}`).toBeGreaterThan(0);
    }
  });

  it('resolves every slash-command description in both languages', () => {
    for (const cmd of COMMANDS) {
      expect(en[cmd.descriptionKey]).toBeTruthy();
      expect(zh[cmd.descriptionKey]).toBeTruthy();
    }
  });

  it('resolves every tip in both languages', () => {
    for (const tip of TIPS) {
      expect(en[tip.textKey]).toBeTruthy();
      expect(zh[tip.textKey]).toBeTruthy();
    }
  });

  it('keeps placeholder sets identical across languages', () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(zh[key]), key).toEqual(placeholders(en[key]));
    }
  });
});
