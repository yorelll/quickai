import { describe, it, expect } from 'vitest';
import { configHelp } from '../configHelpers';
import type { TranslationKey } from '../../i18n';
import { en } from '../../i18n/en';
import { zh } from '../../i18n/zh';

describe('configHelp', () => {
  it('resolves a dictionary key for every field', () => {
    // Each entry is a thunk so `configHelp` sees literal section/key arguments
    // (its generics cannot resolve a widened union).
    const cases: Array<() => TranslationKey> = [
      () => configHelp('prompt', 'system'),
      () => configHelp('window', 'overlay_width'),
      () => configHelp('window', 'max_chat_height'),
      () => configHelp('window', 'max_images'),
      () => configHelp('quote', 'max_display_lines'),
      () => configHelp('quote', 'max_display_chars'),
      () => configHelp('quote', 'max_context_length'),
      () => configHelp('chat', 'provider'),
      () => configHelp('chat', 'model'),
      () => configHelp('chat', 'base_url'),
      () => configHelp('agent', 'provider'),
      () => configHelp('agent', 'model'),
      () => configHelp('agent', 'base_url'),
    ];

    for (const getHelpKey of cases) {
      const helpKey = getHelpKey();
      expect(en[helpKey], helpKey).toBeTruthy();
      expect(zh[helpKey], helpKey).toBeTruthy();
    }
  });
});
