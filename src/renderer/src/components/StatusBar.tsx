import { useEffect, useState } from 'react'
import type { DeviceSpec } from '@shared/devices'
import { BatteryIcon, SignalIcon, WifiIcon } from './icons'

function clock(): string {
  const d = new Date()
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function StatusBar({ device }: { device: DeviceSpec }) {
  const [time, setTime] = useState(clock)
  useEffect(() => {
    const id = setInterval(() => setTime(clock()), 10_000)
    return () => clearInterval(id)
  }, [])
  const height = device.notch ? device.statusBarHeight : 20
  return (
    <div
      className={`statusBar ${device.notch ? 'notch' : ''}`}
      style={{ ['--status-h' as string]: `${height}px` }}
    >
      <span>{time}</span>
      {device.notch && <span className="notchShape" />}
      <span className="icons">
        <SignalIcon />
        <WifiIcon />
        <BatteryIcon />
      </span>
    </div>
  )
}
