/**
 * Settings panel type definitions.
 *
 * These mirror the Rust `AppConfig` schema (snake_case) so the
 * frontend can pass values straight through `set_config_field`
 * without an intermediate camelCase translation.
 */

import type { Translate } from '../i18n';

export interface RawAppConfig {
  general: {
    hotkey: string;
    language: string;
    data_dir: string;
  };
  prompt: {
    system: string;
  };
  window: {
    overlay_width: number;
    max_chat_height: number;
    max_images: number;
  };
  quote: {
    max_display_lines: number;
    max_display_chars: number;
    max_context_length: number;
  };
  chat: {
    provider: string;
    model: string;
    base_url: string;
  };
  agent: {
    mode: string;
    provider: string;
    model: string;
    base_url: string;
    permission: string;
  };
}

/** Tagged union returned by the Rust `set_config_field` command on failure. */
export type ConfigError =
  | { kind: 'seed_failed'; path: string; source: string }
  | { kind: 'io_error'; path: string; source: string }
  | { kind: 'unknown_section'; section: string }
  | { kind: 'unknown_field'; section: string; key: string }
  | { kind: 'type_mismatch'; section: string; key: string; message: string }
  | { kind: 'parse'; path: string; message: string };

/** Recovery marker payload returned by `get_corrupt_marker`. */
export interface CorruptMarker {
  path: string;
  ts: number;
}

/** Identifier for the active Settings tab. */
export type SettingsTabId = 'general' | 'ai' | 'display' | 'agent' | 'about';

/** Localizes a `set_config_field` failure into user-facing copy. */
export function describeConfigError(err: unknown, t: Translate): string {
  if (typeof err !== 'object' || err === null) {
    return t('configError.generic');
  }
  const e = err as Partial<ConfigError> & { kind?: string; message?: string };
  switch (e.kind) {
    case 'io_error':
      return t('configError.ioError', { source: e.source ?? 'I/O error' });
    case 'unknown_section':
      return t('configError.unknownSection', { section: e.section ?? '' });
    case 'unknown_field':
      return t('configError.unknownField', {
        section: e.section ?? '',
        key: e.key ?? '',
      });
    case 'type_mismatch':
      return e.message ?? t('configError.typeMismatch');
    case 'parse':
      return t('configError.parse');
    case 'seed_failed':
      return t('configError.seedFailed', { source: e.source ?? '' });
    default:
      return typeof e.message === 'string'
        ? e.message
        : t('configError.generic');
  }
}
