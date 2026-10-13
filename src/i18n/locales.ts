/**
 * Locale identifiers supported by QuickAI and the helpers that resolve which
 * one to use on a cold start.
 */

export type Locale = 'en' | 'zh';

/** All supported locales, in the order shown in the language switcher. */
export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'zh'];

/** localStorage key that persists the user's explicit language choice. */
export const LANGUAGE_STORAGE_KEY = 'quickai.uiLanguage';

/** Returns true when `value` is one of the supported locale identifiers. */
export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'zh';
}
