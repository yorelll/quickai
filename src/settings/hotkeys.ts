/**
 * Double-tap summon hotkey metadata shared by the General and About tabs.
 *
 * The wire strings match the Rust `[general].hotkey` values exactly
 * (`"ctrl" | "alt" | "shift" | "win"`) — see `task/BATCH2.md`.
 */

import type { TranslationKey } from '../i18n';

/** Selector values accepted by the backend for `[general].hotkey`. */
export const HOTKEYS = ['ctrl', 'alt', 'shift', 'win'] as const;

export type Hotkey = (typeof HOTKEYS)[number];

const HOTKEY_LABEL_KEYS: Record<Hotkey, TranslationKey> = {
  ctrl: 'hotkey.ctrl',
  alt: 'hotkey.alt',
  shift: 'hotkey.shift',
  win: 'hotkey.win',
};

/** Narrows an arbitrary config string to a known hotkey, defaulting to Ctrl. */
export function normalizeHotkey(value: string): Hotkey {
  return (HOTKEYS as readonly string[]).includes(value)
    ? (value as Hotkey)
    : 'ctrl';
}

/** Localized display name for a hotkey. */
export function hotkeyLabelKey(hotkey: Hotkey): TranslationKey {
  return HOTKEY_LABEL_KEYS[hotkey];
}
