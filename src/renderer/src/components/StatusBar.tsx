import { useEffect, useState } from 'react'
import { deviceHasIsland, statusBarInset, type DeviceSpec } from '@shared/devices'
import { BatteryIcon, SignalIcon, WifiIcon } from './icons'

function clock(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function StatusBar({ device }: { device: DeviceSpec }) {
  const [time, setTime] = useState(clock)
  useEffect(() => {
    const id = setInterval(() => setTime(clock()), 10_000)
    return () => clearInterval(id)
  }, [])
  const height = device.notch ? device.statusBarHeight : 20
  const island = deviceHasIsland(device)
  return (
    <div
      className={['statusBar', device.notch && 'notch', island && 'island']
        .filter(Boolean)
        .join(' ')}
      style={{
        ['--status-h' as string]: `${height}px`,
        ['--status-inset' as string]: `${statusBarInset(device)}px`
      }}
    >
      <span className="clock">{time}</span>
      {device.notch && <span className={island ? 'notchShape island' : 'notchShape'} aria-hidden />}
      <span className="icons" aria-hidden>
        <SignalIcon />
        <WifiIcon />
        <BatteryIcon />
      </span>
    </div>
  )
}
