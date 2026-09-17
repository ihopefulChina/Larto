/**
 * Serial CDP work with latest-wins skipping. A newer enqueue makes any still-queued
 * predecessor a no-op so out-of-order `Emulation.*` replies cannot restore stale metrics.
 */
export function createLatestWinsQueue(): {
  enqueue: <T>(work: (isLatest: () => boolean) => Promise<T>) => Promise<T | undefined>
} {
  let tail: Promise<void> = Promise.resolve()
  let ticket = 0
  return {
    enqueue<T>(work: (isLatest: () => boolean) => Promise<T>): Promise<T | undefined> {
      const mine = ++ticket
      const isLatest = () => mine === ticket
      const run = tail.then(
        async () => {
          if (!isLatest()) return undefined
          return await work(isLatest)
        },
        async () => {
          if (!isLatest()) return undefined
          return await work(isLatest)
        }
      )
      tail = run.then(
        () => undefined,
        () => undefined
      )
      return run
    }
  }
}
