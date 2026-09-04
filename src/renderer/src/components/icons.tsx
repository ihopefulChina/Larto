import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>
const base = { viewBox: '0 0 24 24', xmlns: 'http://www.w3.org/2000/svg' }

export const RefreshIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
  </svg>
)
export const ChevronDown = (p: P) => (
  <svg {...base} {...p}>
    <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
  </svg>
)
export const BackIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
  </svg>
)
export const CloseIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </svg>
)
export const MoreIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm12 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
  </svg>
)
export const UserIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5z" />
  </svg>
)
/** QR-style mark for 预览 (scan / push preview). */
export const PreviewIcon = (p: P) => (
  <svg {...base} {...p}>
    <path
      fillRule="evenodd"
      d="M3 3h8v8H3V3zm2 2v4h4V5H5zM13 3h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zM14 13h3v3h-3v-3zm5 0h3v3h-3v-3zm-5 5h3v3h-3v-3zm5 0h3v3h-3v-3z"
    />
  </svg>
)
export const TrashIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9 3h6l1 2h4v2H4V5h4l1-2zM6 8h12l-1 11.2A2 2 0 0 1 15.01 21H8.99A2 2 0 0 1 7 19.2L6 8z" />
  </svg>
)
export const PhoneIcon = (p: P) => (
  <svg {...base} {...p}>
    <path
      fillRule="evenodd"
      d="M7 1.5h10A2.5 2.5 0 0 1 19.5 4v16a2.5 2.5 0 0 1-2.5 2.5H7A2.5 2.5 0 0 1 4.5 20V4A2.5 2.5 0 0 1 7 1.5zM8 5h8v12.5H8V5z"
    />
  </svg>
)
export const CodeIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M8.7 7.3 4 12l4.7 4.7 1.4-1.4L6.8 12l3.3-3.3-1.4-1.4zm6.6 0-1.4 1.4L17.2 12l-3.3 3.3 1.4 1.4L20 12l-4.7-4.7z" />
  </svg>
)
export const WifiIcon = (p: P) => (
  <svg viewBox="0 0 16 12" {...p}>
    <path d="M8 9.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM8 6a5.5 5.5 0 0 1 3.9 1.6l-1.4 1.4A3.5 3.5 0 0 0 8 8a3.5 3.5 0 0 0-2.5 1L4.1 7.6A5.5 5.5 0 0 1 8 6zm0-4a9.5 9.5 0 0 1 6.7 2.8l-1.4 1.4A7.5 7.5 0 0 0 8 4a7.5 7.5 0 0 0-5.3 2.2L1.3 4.8A9.5 9.5 0 0 1 8 2z" />
  </svg>
)
export const BatteryIcon = (p: P) => (
  <svg viewBox="0 0 26 12" {...p}>
    <rect x="0.5" y="0.5" width="22" height="11" rx="2.5" fill="none" stroke="currentColor" />
    <rect x="2" y="2" width="19" height="8" rx="1.5" />
    <rect x="23.5" y="4" width="2" height="4" rx="1" />
  </svg>
)
export const SignalIcon = (p: P) => (
  <svg viewBox="0 0 18 12" {...p}>
    <rect x="0" y="8" width="3" height="4" rx="0.8" />
    <rect x="5" y="6" width="3" height="6" rx="0.8" />
    <rect x="10" y="3" width="3" height="9" rx="0.8" />
    <rect x="15" y="0" width="3" height="12" rx="0.8" />
  </svg>
)
