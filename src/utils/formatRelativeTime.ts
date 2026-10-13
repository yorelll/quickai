/**
 * Maps a Unix timestamp (milliseconds) to a localized relative-time
 * descriptor: a translation key plus an optional count for the `{count}`
 * placeholder. Rendering the string is the caller's job so the label
 * re-renders when the language changes.
 */
import type { TranslationKey } from '../i18n';

export interface RelativeTime {
  key: TranslationKey;
  /** Present for every bucket except "just now". */
  count?: number;
}

export function formatRelativeTime(
  unixMillis: number,
  nowMillis?: number,
): RelativeTime {
  const now = nowMillis ?? Date.now();
  const diffSec = Math.max(0, Math.floor((now - unixMillis) / 1000));

  if (diffSec < 60) return { key: 'time.justNow' };

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return { key: 'time.minutesAgo', count: diffMin };

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return { key: 'time.hoursAgo', count: diffHr };

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 14) return { key: 'time.daysAgo', count: diffDay };

  const diffWeek = Math.floor(diffDay / 7);
  return { key: 'time.weeksAgo', count: diffWeek };
}
