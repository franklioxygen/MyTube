import { describe, expect, it } from 'vitest';
import { settingsQueryOptions } from '../settingsQueries';

describe('settingsQueryOptions', () => {
  it('always refetches settings on mount, focus, and reconnect', () => {
    expect(settingsQueryOptions.refetchOnMount).toBe('always');
    expect(settingsQueryOptions.refetchOnWindowFocus).toBe('always');
    expect(settingsQueryOptions.refetchOnReconnect).toBe('always');
  });
});
