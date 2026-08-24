/**
 * Process-wide pip serialization.
 *
 * Staging isolation makes concurrent pip runs safe, but they still compete for
 * the package index and download bandwidth. Serializing in one place covers
 * both the managed installer and any remaining fallback callers.
 */
let pipQueue: Promise<unknown> = Promise.resolve();

export function withPipLock<T>(task: () => Promise<T>): Promise<T> {
  const run = pipQueue.then(task, task);
  pipQueue = run.catch(() => undefined);
  return run;
}

/**
 * @internal Test helper: drop a queue tail left pending by a mocked pip run.
 */
export function resetPipQueue(): void {
  pipQueue = Promise.resolve();
}
