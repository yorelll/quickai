/**
 * Tooltip copy for every user-tunable Settings field.
 *
 * Maps the same (section, key) pair the backend's `set_config_field`
 * allowlist uses to the translation key rendered in the field's help bubble.
 */

import type { TranslationKey } from '../i18n';

const HELP_KEYS = {
  prompt: {
    system: 'help.prompt.system',
  },
  window: {
    overlay_width: 'help.window.overlay_width',
    max_chat_height: 'help.window.max_chat_height',
    max_images: 'help.window.max_images',
  },
  quote: {
    max_display_lines: 'help.quote.max_display_lines',
    max_display_chars: 'help.quote.max_display_chars',
    max_context_length: 'help.quote.max_context_length',
  },
  chat: {
    provider: 'help.chat.provider',
    model: 'help.chat.model',
    base_url: 'help.chat.base_url',
  },
  agent: {
    provider: 'help.agent.provider',
    model: 'help.agent.model',
    base_url: 'help.agent.base_url',
  },
} as const;

export function configHelp<
  S extends keyof typeof HELP_KEYS,
  K extends keyof (typeof HELP_KEYS)[S],
>(section: S, key: K): TranslationKey {
  // tsc cannot resolve a generic index access across the nested literal
  // object, so widen at this single boundary.
  return HELP_KEYS[section][key] as TranslationKey;
}
