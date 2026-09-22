import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settleAllWithin } from '../../utils/concurrency';

describe('settleAllWithin', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves as soon as every promise has settled', async () => {
    const settled = vi.fn();
    const promise = settleAllWithin(
      [Promise.resolve(1), Promise.reject(new Error('x'))],
      60_000,
    ).then(settled);

    await vi.advanceTimersByTimeAsync(0);
    await promise;

    // Resolved without the timeout having to fire.
    expect(settled).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives up on a promise that never settles', async () => {
    // The case that hangs a MissAV download: a 200 whose body stalls leaves
    // response.text() pending forever.
    const never = new Promise<void>(() => {});
    const settled = vi.fn();
    const promise = settleAllWithin([never, Promise.resolve(1)], 5_000).then(settled);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2);
    await promise;
    expect(settled).toHaveBeenCalled();
  });

  it('does not leave a timer pending after the promises settle', async () => {
    const promise = settleAllWithin([Promise.resolve(1)], 60_000);
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    // A lingering 60s timer would keep the process alive.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves immediately when there is nothing to wait for', async () => {
    await expect(settleAllWithin([], 60_000)).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
