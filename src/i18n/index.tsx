/**
 * Minimal in-repo i18n runtime.
 *
 * A single module-level locale store feeds both the React layer
 * (`useTranslation`, subscribed via `useSyncExternalStore`) and plain helper
 * functions (`t`) that run outside the render tree. Detection order is:
 * persisted choice → `navigator.language` (`zh*` → Chinese) → English.
 */
import {
  useCallback,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { en, type TranslationKey } from './en';
import { zh } from './zh';
import {
  isLocale,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  type Locale,
} from './locales';

export type { Locale, TranslationKey };
export { LANGUAGE_STORAGE_KEY, SUPPORTED_LOCALES };

/** Values interpolated into `{placeholder}` slots in a translation. */
export type TranslateParams = Record<string, string | number>;

/** Signature of a bound translation function. */
export type Translate = (
  key: TranslationKey,
  params?: TranslateParams,
) => string;

const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = { en, zh };

/**
 * Resolves the locale to use on a cold start: a persisted explicit choice
 * wins, otherwise the system language decides (`zh*` → Chinese, else English).
 */
export function detectLocale(): Locale {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (isLocale(stored)) return stored;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** Translates `key` for `locale`, interpolating `{name}` placeholders. */
export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: TranslateParams,
): string {
  const template = DICTIONARIES[locale][key];
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  );
}

// ─── Locale store ──────────────────────────────────────────────────────────

const listeners = new Set<() => void>();
let activeLocale: Locale | null = null;

/** Current locale, resolving detection lazily on first access. */
export function getLocale(): Locale {
  activeLocale ??= detectLocale();
  return activeLocale;
}

/** Persists and switches the active locale, notifying every subscriber. */
export function setLocale(next: Locale): void {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  document.documentElement.lang = next;
  activeLocale = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Translate using the currently active locale (for non-React call sites). */
export function t(key: TranslationKey, params?: TranslateParams): string {
  return translate(getLocale(), key, params);
}

/** The object returned by `useTranslation`. */
export interface TranslationApi {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

/**
 * Subscribes the calling component to the locale store and returns a bound
 * translator. Re-renders whenever the language changes.
 */
export function useTranslation(): TranslationApi {
  const locale = useSyncExternalStore(subscribe, getLocale);
  const boundTranslate = useCallback<Translate>(
    (key, params) => translate(locale, key, params),
    [locale],
  );
  return { locale, setLocale, t: boundTranslate };
}

/**
 * Re-renders its subtree when the language changes. Individual consumers
 * subscribe on their own, so this exists to keep the tree coherent for any
 * descendant that renders translated content without using `useTranslation`.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribe, getLocale);
  // Keep `<html lang>` in sync so the document declares the active language.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <>{children}</>;
}
