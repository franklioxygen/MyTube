/**
 * Run an async worker over items with at most `limit` in flight at once.
 * Items are started in order; a rejected worker propagates and stops
 * scheduling new items, so workers that must never fail the batch should
 * catch internally.
 */
export const runWithConcurrencyLimit = async <T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> => {
  if (items.length === 0) {
    return;
  }

  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;

  const workers = Array.from({ length: effectiveLimit }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex]);
    }
  });

  await Promise.all(workers);
};
