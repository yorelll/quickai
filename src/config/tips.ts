/**
 * Rotating tips shown in the chat-mode tip bar.
 *
 * Each tip carries a translation key (rendered by `TipBar` in the active
 * language) and, optionally, a URL that turns the whole bar into a link
 * opened via the Tauri `open_url` command.
 */

import type { TranslationKey } from '../i18n';

export interface Tip {
  textKey: TranslationKey;
  url?: string;
}

export const TIPS: readonly Tip[] = [
  { textKey: 'tip.screen' },
  { textKey: 'tip.quote' },
  { textKey: 'tip.think' },
  { textKey: 'tip.hide' },
  { textKey: 'tip.dropImage' },
  { textKey: 'tip.pasteImage' },
  { textKey: 'tip.bookmark' },
  { textKey: 'tip.translate' },
  { textKey: 'tip.history' },
  { textKey: 'tip.rewrite' },
  { textKey: 'tip.tldr' },
  { textKey: 'tip.refine' },
  { textKey: 'tip.bullets' },
  { textKey: 'tip.todos' },
  { textKey: 'tip.slashCommands' },
  { textKey: 'tip.combine' },
  { textKey: 'tip.cloud' },
  { textKey: 'tip.imageLimit' },
];
