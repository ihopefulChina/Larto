/**
 * Snippets injected into the docked DevTools frontend (a devtools:// page we own).
 * Nothing here talks to the inspected guest; it only re-skins the frontend and reports
 * inspect-mode toggles back to the main process through console messages.
 */

/** Marker printed by the frontend hook; matched by DevToolsDock. */
export const INSPECT_MARK = '[larto] inspect:'

/**
 * Wraps `InspectorFrontendHost.sendMessageToBackend` so we learn when the user enters or leaves
 * "select an element" mode (`Overlay.setInspectMode`). There is no frontend API for this and the
 * frontend has no preload, so a tagged console message is the channel back to the main process.
 */
export const INSPECT_HOOK_JS = `(() => {
  const host = globalThis.InspectorFrontendHost;
  if (!host || globalThis.__lartoInspectHook) return;
  globalThis.__lartoInspectHook = true;
  const send = host.sendMessageToBackend;
  host.sendMessageToBackend = function (message) {
    try {
      const { method, params } = JSON.parse(message);
      if (method === 'Overlay.setInspectMode')
        console.info(${JSON.stringify(INSPECT_MARK)} + (params && params.mode !== 'none' ? 'on' : 'off'));
    } catch {}
    return send.call(this, message);
  };
})();`

/**
 * Dark-theme overrides so the docked DevTools uses the shell's palette (app.css dark tokens:
 * window #13151a, panel #191c22, toolbar #1c1f26) instead of Chromium's neutral greys.
 * Only surface/divider tokens are remapped; syntax and semantic colours stay stock.
 * Light theme is left untouched (Chromium's white already matches the shell).
 */
export const THEME_CSS = `
:root.theme-with-dark-background {
  --sys-color-cdt-base-container: #13151a !important;
  --sys-color-base-container: #13151a !important;
  --sys-color-omnibox-container: #13151a !important;
  --sys-color-surface: #13151a !important;
  --sys-color-inverse-on-surface: #13151a !important;
  --sys-color-cdt-base: #191c22 !important;
  --sys-color-base: #191c22 !important;
  --sys-color-base-container-elevated: #191c22 !important;
  --sys-color-surface1: #1c1f26 !important;
  --sys-color-surface2: #191c22 !important;
  --sys-color-surface3: #22262e !important;
  --sys-color-surface4: #22262e !important;
  --sys-color-surface5: #22262e !important;
  --sys-color-neutral-container: #1c1f26 !important;
  --sys-color-header-container: #1c1f26 !important;
  --sys-color-surface-variant: #2a2f38 !important;
  --sys-color-divider: rgba(255, 255, 255, 0.08) !important;
  --sys-color-divider-on-tonal-container: rgba(255, 255, 255, 0.08) !important;
  --sys-color-on-base-divider: rgba(255, 255, 255, 0.08) !important;
  --sys-color-divider-prominent: rgba(255, 255, 255, 0.18) !important;
  --sys-color-neutral-outline: #3a404a !important;
  --sys-color-state-hover-dim-blend-protection: rgba(19, 21, 26, 0.1) !important;
  --sys-color-state-hover-bright-blend-protection: rgba(19, 21, 26, 0.16) !important;
  --color-background: #13151a !important;
  --color-background-opacity-50: rgba(19, 21, 26, 0.5) !important;
  --color-background-opacity-80: rgba(19, 21, 26, 0.8) !important;
  --color-background-elevation-1: #191c22 !important;
  --color-background-elevation-2: #1c1f26 !important;
  --color-background-elevation-dark-only: #191c22 !important;
}
`
