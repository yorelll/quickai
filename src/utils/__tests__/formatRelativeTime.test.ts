import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '../formatRelativeTime';

const NOW = 1_700_000_000_000; // milliseconds

describe('formatRelativeTime', () => {
  it('returns the "just now" descriptor under 60 seconds', () => {
    expect(formatRelativeTime(NOW, NOW)).toEqual({ key: 'time.justNow' });
    expect(formatRelativeTime(NOW - 30_000, NOW)).toEqual({
      key: 'time.justNow',
    });
    expect(formatRelativeTime(NOW - 59_000, NOW)).toEqual({
      key: 'time.justNow',
    });
  });

  it('returns a minutes descriptor under 1 hour', () => {
    expect(formatRelativeTime(NOW - 60_000, NOW)).toEqual({
      key: 'time.minutesAgo',
      count: 1,
    });
    expect(formatRelativeTime(NOW - 120_000, NOW)).toEqual({
      key: 'time.minutesAgo',
      count: 2,
    });
    expect(formatRelativeTime(NOW - 3_599_000, NOW)).toEqual({
      key: 'time.minutesAgo',
      count: 59,
    });
  });

  it('returns an hours descriptor under 24 hours', () => {
    expect(formatRelativeTime(NOW - 3_600_000, NOW)).toEqual({
      key: 'time.hoursAgo',
      count: 1,
    });
    expect(formatRelativeTime(NOW - 7_200_000, NOW)).toEqual({
      key: 'time.hoursAgo',
      count: 2,
    });
    expect(formatRelativeTime(NOW - 86_399_000, NOW)).toEqual({
      key: 'time.hoursAgo',
      count: 23,
    });
  });

  it('returns a days descriptor under 14 days', () => {
    expect(formatRelativeTime(NOW - 86_400_000, NOW)).toEqual({
      key: 'time.daysAgo',
      count: 1,
    });
    expect(formatRelativeTime(NOW - 86_400_000 * 7, NOW)).toEqual({
      key: 'time.daysAgo',
      count: 7,
    });
    expect(formatRelativeTime(NOW - 86_400_000 * 13, NOW)).toEqual({
      key: 'time.daysAgo',
      count: 13,
    });
  });

  it('returns a weeks descriptor from 14 days onwards', () => {
    expect(formatRelativeTime(NOW - 86_400_000 * 14, NOW)).toEqual({
      key: 'time.weeksAgo',
      count: 2,
    });
    expect(formatRelativeTime(NOW - 86_400_000 * 21, NOW)).toEqual({
      key: 'time.weeksAgo',
      count: 3,
    });
    expect(formatRelativeTime(NOW - 86_400_000 * 60, NOW)).toEqual({
      key: 'time.weeksAgo',
      count: 8,
    });
  });

  it('clamps negative diffs to "just now"', () => {
    expect(formatRelativeTime(NOW + 100_000, NOW)).toEqual({
      key: 'time.justNow',
    });
  });

  it('defaults to Date.now() when nowMillis is omitted', () => {
    const recent = Date.now() - 5_000;
    expect(formatRelativeTime(recent)).toEqual({ key: 'time.justNow' });
  });
});
