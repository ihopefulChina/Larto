import { afterEach, describe, expect, it, vi } from 'vitest'
import { afterLayout } from '../src/renderer/src/lib/layout'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('afterLayout', () => {
  it('falls back when a hidden window receives no animation frames', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', vi.fn())
    const completed = vi.fn()
    void afterLayout(120).then(completed)

    await vi.advanceTimersByTimeAsync(119)
    expect(completed).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(completed).toHaveBeenCalledOnce()
  })
})
