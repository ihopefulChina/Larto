import { APP_NAME, GITHUB_URL, WEBSITE_URL } from '@shared/constants'
import { invoke } from '@/lib/bridge'
import { useApp, useT } from '@/store/app'
import iconUrl from '@/assets/icon.png'
import { Modal } from '../Modal'

export function AboutModal() {
  const t = useT()
  const info = useApp((s) => s.info)
  const mcp = useApp((s) => s.mcp)
  const diagnostics = info
    ? [
        `${APP_NAME} ${info.version} (${info.arch}${info.isPackaged ? '' : ', dev'})`,
        `Electron ${info.electron} / Chromium ${info.chrome} / Node ${info.node}`,
        `MCP: ${mcp.running ? mcp.url : 'off'}`,
        `Logs: ${info.logPath}`
      ].join('\n')
    : ''
  const link = (url: string, label: string) => (
    <a
      href={url}
      onClick={(e) => {
        e.preventDefault()
        void invoke('app:openExternal', url)
      }}
    >
      {label}
    </a>
  )
  return (
    <Modal
      title={t('about.title')}
      width={380}
      footer={
        <>
          <button type="button" className="btn" onClick={() => void invoke('app:openLogFolder')}>
            {t('menu.openLogs')}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void invoke('app:copyText', diagnostics)}
          >
            {t('about.copy')}
          </button>
        </>
      }
    >
      <div className="about">
        <img src={iconUrl} alt="" width={96} height={96} />
        <h2>{APP_NAME}</h2>
        <div className="meta">
          {t('about.version')} {info?.version ?? '…'} · {info?.arch}
          <br />
          Electron {info?.electron} · Chromium {info?.chrome}
          <br />
          {link(WEBSITE_URL, 'Website')} · {link(GITHUB_URL, 'GitHub')} · MIT License
        </div>
      </div>
    </Modal>
  )
}
