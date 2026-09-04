/**
 * Wait for React/CSS layout without hanging automation while Chromium throttles animation frames
 * for a hidden or minimized Electron window.
 */
export function afterLayout(timeoutMs = 120): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    requestAnimationFrame(() => requestAnimationFrame(finish))
  })
}
