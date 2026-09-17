import { describe, expect, it } from 'vitest'
import {
  autoSimulatorColumnWidth,
  clampSimulatorColumnWidth,
  DEVTOOLS_COLUMN_MIN_W,
  IDE_RESIZER_W,
  isSplitPress,
  isSplitRelease,
  sameIdeSplitLayout,
  PC_SIMULATOR_COLUMN_DEFAULT_W,
  sashViewBounds,
  SIMULATOR_COLUMN_MAX_W,
  SIMULATOR_COLUMN_MIN_W,
  SIMULATOR_COLUMN_PAD_W
} from '../src/shared/ide-split'

describe('ide-split', () => {
  it('uses the official PC default and device-sized mobile auto width', () => {
    expect(autoSimulatorColumnWidth({ platform: 'pc', width: 900 }, 100)).toBe(
      PC_SIMULATOR_COLUMN_DEFAULT_W
    )
    expect(autoSimulatorColumnWidth({ platform: 'ios', width: 390 }, 100)).toBe(
      390 + SIMULATOR_COLUMN_PAD_W
    )
    expect(autoSimulatorColumnWidth({ platform: 'ios', width: 360 }, 100)).toBe(
      SIMULATOR_COLUMN_MIN_W
    )
    expect(autoSimulatorColumnWidth({ platform: 'ios', width: 430 }, 150)).toBe(
      Math.ceil(430 * 1.5) + SIMULATOR_COLUMN_PAD_W
    )
  })

  it('keeps both columns above their official floors when the panel is wide enough', () => {
    const panel = 1200
    expect(clampSimulatorColumnWidth(500, panel)).toBe(500)
    expect(clampSimulatorColumnWidth(200, panel)).toBe(SIMULATOR_COLUMN_MIN_W)
    expect(clampSimulatorColumnWidth(2000, panel)).toBe(
      panel - IDE_RESIZER_W - DEVTOOLS_COLUMN_MIN_W
    )
  })

  it('does not shrink the simulator below its floor on a narrow panel', () => {
    expect(clampSimulatorColumnWidth(500, 600)).toBe(SIMULATOR_COLUMN_MIN_W)
  })

  it('never returns a width the settings schema would reject', () => {
    expect(clampSimulatorColumnWidth(5000, 20_000)).toBe(5000)
    expect(clampSimulatorColumnWidth(20_000, 40_000)).toBe(SIMULATOR_COLUMN_MAX_W)
    expect(SIMULATOR_COLUMN_MAX_W).toBeGreaterThan(4000)
  })

  it('places the native sash on the 10px gap after the simulator column', () => {
    const layout = {
      enabled: true,
      panelLeft: 0,
      panelWidth: 1200,
      panelTop: 40,
      panelBottom: 800,
      columnWidth: 500
    }
    expect(sashViewBounds(layout)).toEqual({ x: 500, y: 40, width: IDE_RESIZER_W, height: 760 })
  })

  it('treats mouseDown and pointerDown as a press, mouseUp as a release', () => {
    expect(isSplitPress('mouseDown')).toBe(true)
    expect(isSplitPress('pointerDown')).toBe(true)
    expect(isSplitPress('mouseMove')).toBe(false)
    expect(isSplitRelease('mouseUp')).toBe(true)
    expect(isSplitRelease('pointerUp')).toBe(true)
  })

  it('compares split layouts by their geometry, not identity', () => {
    const layout = {
      enabled: true,
      panelLeft: 0,
      panelWidth: 1200,
      panelTop: 40,
      panelBottom: 800,
      columnWidth: 500
    }
    expect(sameIdeSplitLayout(layout, { ...layout })).toBe(true)
    expect(sameIdeSplitLayout(layout, { ...layout, columnWidth: 501 })).toBe(false)
  })
})
