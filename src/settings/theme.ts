/**
 * Theme metadata shared by the Settings selector and the app-wide application
 * of `document.documentElement.dataset.theme`.
 *
 * The wire strings match the Rust `[general].theme` values exactly
 * (`"dark" | "light"`); dark is the default. The light palette is defined in
 * CSS under `:root[data-theme="light"]`, so applying a theme only needs to
 * swap that attribute.
 */

import type { TranslationKey } from '../i18n';

/** Selector values accepted by the backend for `[general].theme`. */
export const THEMES = ['dark', 'light'] as const;

export type Theme = (typeof THEMES)[number];

const THEME_LABEL_KEYS: Record<Theme, TranslationKey> = {
  dark: 'theme.dark',
  light: 'theme.light',
};

/** Narrows an arbitrary config string to a known theme, defaulting to dark. */
export function normalizeTheme(value: string): Theme {
  return value === 'light' ? 'light' : 'dark';
}

/** Localized display name for a theme. */
export function themeLabelKey(theme: Theme): TranslationKey {
  return THEME_LABEL_KEYS[theme];
}

/**
 * Applies a theme to the document root. Dark is the base palette, so setting
 * `data-theme="light"` activates the overrides and anything else falls back
 * to dark.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
