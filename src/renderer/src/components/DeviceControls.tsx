import { DEVICES, ZOOM_LEVELS, deviceMenuGroup, findDevice } from '@shared/devices'
import { useApp, useT } from '@/store/app'
import { simulatorActions } from '@/store/simulator'
import { Dropdown } from './Dropdown'
import { ChevronDown } from './icons'

/** Device and zoom menus — sit in the window command bar next to the address field. */
export function DeviceControls() {
  const t = useT()
  const settings = useApp((s) => s.settings)
  const setSetting = useApp((s) => s.setSetting)
  const device = findDevice(settings.deviceId)
  const zoom = ZOOM_LEVELS.includes(settings.zoom) ? settings.zoom : 100

  return (
    <div className="simulatorChrome">
      <Dropdown
        className="wide"
        trigger={(open, toggle) => (
          <button
            type="button"
            className="tbtn"
            onClick={toggle}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`${t('menu.device')}: ${device.name}`}
          >
            {device.name} <ChevronDown aria-hidden className="chevron" />
          </button>
        )}
      >
        {(close) =>
          DEVICES.flatMap((d, i) => {
            const prev = i > 0 ? DEVICES[i - 1] : undefined
            const sep =
              prev && deviceMenuGroup(prev) !== deviceMenuGroup(d) ? (
                <div key={`sep-${d.id}`} className="menu-sep" role="separator" />
              ) : null
            const item = (
              <button
                key={d.id}
                type="button"
                role="menuitemradio"
                className={`menu-item ${d.id === device.id ? 'checked' : ''}`}
                aria-checked={d.id === device.id}
                onClick={() => {
                  close()
                  void simulatorActions.changeDevice(d.id)
                }}
              >
                {d.name}
                <span className="dim">
                  {d.width}×{d.height}
                </span>
              </button>
            )
            return sep ? [sep, item] : [item]
          })
        }
      </Dropdown>
      <Dropdown
        trigger={(open, toggle) => (
          <button
            type="button"
            className="tbtn"
            onClick={toggle}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`${t('menu.zoom')}: ${zoom}%`}
          >
            {zoom}% <ChevronDown aria-hidden className="chevron" />
          </button>
        )}
      >
        {(close) =>
          ZOOM_LEVELS.map((z) => (
            <button
              key={z}
              type="button"
              role="menuitemradio"
              className={`menu-item ${z === zoom ? 'checked' : ''}`}
              aria-checked={z === zoom}
              onClick={() => {
                close()
                void setSetting('zoom', z)
              }}
            >
              {z}%
            </button>
          ))
        }
      </Dropdown>
    </div>
  )
}
