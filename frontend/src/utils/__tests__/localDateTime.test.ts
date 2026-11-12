import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLocalDateTimeOptions } from '../localDateTime';

afterEach(() => vi.unstubAllEnvs());

describe('getLocalDateTimeOptions', () => {
  it('returns both occurrences of a repeated New York hour', () => {
    vi.stubEnv('TZ', 'America/New_York');
    expect(getLocalDateTimeOptions('2024-11-03T01:30').map((option) => ({
      iso: new Date(option.timestamp).toISOString(), label: option.label,
    }))).toEqual([
      { iso: '2024-11-03T05:30:00.000Z', label: 'UTC-04:00' },
      { iso: '2024-11-03T06:30:00.000Z', label: 'UTC-05:00' },
    ]);
  });

  it('handles a thirty-minute overlap without assuming a one-hour transition', () => {
    vi.stubEnv('TZ', 'Australia/Lord_Howe');
    expect(getLocalDateTimeOptions('2024-04-07T01:45').map((option) => new Date(option.timestamp).toISOString()))
      .toEqual(['2024-04-06T14:45:00.000Z', '2024-04-06T15:15:00.000Z']);
  });

  it('supports fractional-hour offsets and fractional seconds', () => {
    vi.stubEnv('TZ', 'Asia/Kolkata');
    const options = getLocalDateTimeOptions('2026-11-12T10:30:45.12');
    expect(options).toHaveLength(1);
    expect(options[0].label).toBe('UTC+05:30');
    expect(new Date(options[0].timestamp).toISOString()).toBe('2026-11-12T05:00:45.120Z');
  });

  it('accepts leap day and a zero UTC offset', () => {
    vi.stubEnv('TZ', 'UTC');
    expect(getLocalDateTimeOptions('2024-02-29T10:30')[0].label).toBe('UTC+00:00');
  });

  it.each(['', 'invalid', '2026-02-29T10:30', '2026-04-31T10:30', '2024-03-10T02:30', '2026-11-12T25:00'])(
    'rejects invalid or nonexistent local time %s', (value) => {
      vi.stubEnv('TZ', 'America/New_York');
      expect(getLocalDateTimeOptions(value)).toEqual([]);
    }
  );
});
