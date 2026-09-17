/**
 * Official H5 debugger uses a two-column `.resize-colunm`: left min 442 / default 500
 * (device width + 64 after a device switch), right min 300. We keep the same sash
 * behaviour with the chrome widths this shell already uses (410 / +32).
 */
export const SIMULATOR_COLUMN_MIN_W = 410
/** Hard cap shared by runtime clamp and settings.json so persist never throws Zod. */
export const SIMULATOR_COLUMN_MAX_W = 16_000
export const DEVTOOLS_COLUMN_MIN_W = 300
export const IDE_RESIZER_W = 10
export const SIMULATOR_COLUMN_PAD_W = 32
export const PC_SIMULATOR_COLUMN_DEFAULT_W = 500

export interface IdeSplitLayout {
  enabled: boolean
  panelLeft: number
  panelWidth: number
  panelTop: number
  panelBottom: number
  columnWidth: number
}

export function autoSimulatorColumnWidth(
  device: { platform: string; width: number },
  zoom: number
): number {
  if (device.platform === 'pc') return PC_SIMULATOR_COLUMN_DEFAULT_W
  return Math.max(
    SIMULATOR_COLUMN_MIN_W,
    Math.ceil(device.width * (zoom / 100)) + SIMULATOR_COLUMN_PAD_W
  )
}

export function clampSimulatorColumnWidth(width: number, panelWidth: number): number {
  const wanted = Math.round(width)
  const maxLeft = panelWidth - IDE_RESIZER_W - DEVTOOLS_COLUMN_MIN_W
  if (!Number.isFinite(panelWidth) || panelWidth <= 0 || maxLeft < SIMULATOR_COLUMN_MIN_W) {
    return SIMULATOR_COLUMN_MIN_W
  }
  return Math.min(maxLeft, SIMULATOR_COLUMN_MAX_W, Math.max(SIMULATOR_COLUMN_MIN_W, wanted))
}

export function sameIdeSplitLayout(a: IdeSplitLayout, b: IdeSplitLayout): boolean {
  return (
    a.enabled === b.enabled &&
    a.panelLeft === b.panelLeft &&
    a.panelWidth === b.panelWidth &&
    a.panelTop === b.panelTop &&
    a.panelBottom === b.panelBottom &&
    a.columnWidth === b.columnWidth
  )
}

/** Native sash strip sitting on the 10px flex gap between the two columns. */
export function sashViewBounds(layout: IdeSplitLayout): {
  x: number
  y: number
  width: number
  height: number
} {
  return {
    x: Math.round(layout.panelLeft + layout.columnWidth),
    y: Math.round(layout.panelTop),
    width: IDE_RESIZER_W,
    height: Math.max(0, Math.round(layout.panelBottom - layout.panelTop))
  }
}

export function isSplitPress(type: string): boolean {
  return type === 'mouseDown' || type === 'pointerDown'
}

export function isSplitRelease(type: string): boolean {
  return type === 'mouseUp' || type === 'pointerUp'
}
