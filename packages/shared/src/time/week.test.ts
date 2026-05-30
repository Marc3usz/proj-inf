import { describe, expect, it } from 'vitest';
import { previousFullWeek, previousFullWeekWarsaw } from './week.js';

describe('previousFullWeekWarsaw', () => {
  it('returns the previous Warsaw calendar week using the winter UTC offset', () => {
    const range = previousFullWeekWarsaw(new Date('2025-01-15T12:00:00.000Z'));

    expect(range.date_from.toISOString()).toBe('2025-01-05T23:00:00.000Z');
    expect(range.date_to.toISOString()).toBe('2025-01-12T22:59:59.999Z');
  });

  it('returns the previous Warsaw calendar week using the summer UTC offset', () => {
    const range = previousFullWeekWarsaw(new Date('2025-07-16T12:00:00.000Z'));

    expect(range.date_from.toISOString()).toBe('2025-07-06T22:00:00.000Z');
    expect(range.date_to.toISOString()).toBe('2025-07-13T21:59:59.999Z');
  });

  it('returns the same instants when the host timezone is UTC', () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'UTC';

    try {
      const range = previousFullWeekWarsaw(new Date('2025-01-15T12:00:00.000Z'));

      expect(range.date_from.toISOString()).toBe('2025-01-05T23:00:00.000Z');
      expect(range.date_to.toISOString()).toBe('2025-01-12T22:59:59.999Z');
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });

  it('supports agency timezone other than Warsaw', () => {
    const range = previousFullWeek(new Date('2025-01-15T12:00:00.000Z'), 'America/New_York');

    expect(range.date_from.toISOString()).toBe('2025-01-06T05:00:00.000Z');
    expect(range.date_to.toISOString()).toBe('2025-01-13T04:59:59.999Z');
  });
});
