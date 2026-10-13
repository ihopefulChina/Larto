/**
 * While a shell popover (history dropdown, device/zoom/account menus) is open, the simulator
 * `<webview>` must not take the pointer. The webview is an OOPIF: Electron routes its events by
 * geometry in the browser process, and on macOS the guest surface can outrank DOM painted above
 * it — menu items hanging over the page then stop receiving hover/clicks entirely (the dropdown
 * stays open, nothing reacts). Setting `pointer-events: none` on the webview (see app.css,
 * `[data-popover-open]`) removes the guest region from the embedder's hit-test data for the
 * popover's lifetime. Reference-counted because popovers can stack (URL bar + confirm dialog).
 */
let count = 0

export function popoverShield(active: boolean): void {
  count = Math.max(0, count + (active ? 1 : -1))
  if (count > 0) document.documentElement.dataset['popoverOpen'] = '1'
  else delete document.documentElement.dataset['popoverOpen']
}
