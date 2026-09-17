import { describe, expect, it } from 'vitest'
import { createLatestWinsQueue } from '../src/main/cdp-queue'

describe('createLatestWinsQueue', () => {
  it('runs a single job', async () => {
    const queue = createLatestWinsQueue()
    const value = await queue.enqueue(async () => 7)
    expect(value).toBe(7)
  })

  it('drops jobs that are still queued when a newer one arrives', async () => {
    const queue = createLatestWinsQueue()
    const ran: number[] = []
    const first = queue.enqueue(async () => {
      ran.push(1)
      return 1
    })
    const second = queue.enqueue(async () => {
      ran.push(2)
      return 2
    })
    const third = queue.enqueue(async () => {
      ran.push(3)
      return 3
    })
    expect(await first).toBeUndefined()
    expect(await second).toBeUndefined()
    expect(await third).toBe(3)
    expect(ran).toEqual([3])
  })

  it('lets an already-running job finish, then runs only the latest successor', async () => {
    const queue = createLatestWinsQueue()
    const ran: number[] = []
    let release!: () => void
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = queue.enqueue(async () => {
      ran.push(1)
      await hold
      return 1
    })
    await Promise.resolve()
    const second = queue.enqueue(async () => {
      ran.push(2)
      return 2
    })
    const third = queue.enqueue(async () => {
      ran.push(3)
      return 3
    })

    release()
    expect(await first).toBe(1)
    expect(await second).toBeUndefined()
    expect(await third).toBe(3)
    expect(ran).toEqual([1, 3])
  })
})
