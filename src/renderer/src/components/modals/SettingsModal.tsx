import { useState } from 'react'
import type { FeishuEnv, Language, ProxySettings, ThemeMode } from '@shared/settings'
import { useApp, useT } from '@/store/app'
import { Modal } from '../Modal'

export function SettingsModal() {
  const t = useT()
  const settings = useApp((s) => s.settings)
  const mcp = useApp((s) => s.mcp)
  const setSetting = useApp((s) => s.setSetting)
  const [proxy, setProxy] = useState<ProxySettings>(settings.proxy)
  const [mcpPort, setMcpPort] = useState(String(settings.mcp.port))
  const [lat, setLat] = useState(
    settings.mockLocation ? String(settings.mockLocation.latitude) : ''
  )
  const [lng, setLng] = useState(
    settings.mockLocation ? String(settings.mockLocation.longitude) : ''
  )

  const commitProxy = (next: ProxySettings) => {
    setProxy(next)
    void setSetting('proxy', next)
  }
  const commitMcpPort = () => {
    const port = Number(mcpPort)
    if (Number.isInteger(port) && port >= 1024 && port <= 65535 && port !== settings.mcp.port)
      void setSetting('mcp', { ...settings.mcp, port })
    else setMcpPort(String(settings.mcp.port))
  }
  const commitLocation = () => {
    const la = Number(lat)
    const ln = Number(lng)
    if (lat === '' && lng === '') void setSetting('mockLocation', null)
    else if (Number.isFinite(la) && Number.isFinite(ln))
      void setSetting('mockLocation', { latitude: la, longitude: ln })
  }

  const seg = <V extends string>(value: V, options: [V, string][], onChange: (v: V) => void) => (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button key={v} className={v === value ? 'active' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )

  return (
    <Modal title={t('settings.title')} width={520}>
      <div className="section-title">{t('settings.general')}</div>
      <div className="field">
        <label>{t('settings.appearance')}</label>
        {seg<ThemeMode>(
          settings.theme,
          [
            ['system', t('menu.appearance.system')],
            ['light', t('menu.appearance.light')],
            ['dark', t('menu.appearance.dark')]
          ],
          (v) => void setSetting('theme', v)
        )}
      </div>
      <div className="field">
        <label>{t('settings.language')}</label>
        {seg<Language>(
          settings.language,
          [
            ['system', t('menu.language.system')],
            ['zh-CN', '简体中文'],
            ['en-US', 'English']
          ],
          (v) => void setSetting('language', v)
        )}
      </div>
      <div className="field">
        <label>{t('settings.env')}</label>
        {seg<FeishuEnv>(
          settings.env,
          [
            ['feishu', t('settings.env.feishu')],
            ['lark', t('settings.env.lark')]
          ],
          (v) => void setSetting('env', v)
        )}
      </div>

      <div className="section-title">{t('settings.proxy')}</div>
      <div className="field">
        <label>{t('settings.proxy')}</label>
        {seg<ProxySettings['mode']>(
          proxy.mode,
          [
            ['system', t('settings.proxy.system')],
            ['none', t('settings.proxy.none')],
            ['manual', t('settings.proxy.manual')]
          ],
          (mode) => commitProxy({ ...proxy, mode })
        )}
      </div>
      {proxy.mode === 'manual' && (
        <>
          <div className="field">
            <label>{t('settings.proxy.url')}</label>
            <input
              type="text"
              placeholder="http://127.0.0.1:7890"
              value={proxy.url}
              onChange={(e) => setProxy({ ...proxy, url: e.target.value })}
              onBlur={() => commitProxy(proxy)}
            />
          </div>
          <div className="field">
            <label>{t('settings.proxy.bypass')}</label>
            <input
              type="text"
              value={proxy.bypass}
              onChange={(e) => setProxy({ ...proxy, bypass: e.target.value })}
              onBlur={() => commitProxy(proxy)}
            />
          </div>
        </>
      )}

      <div className="section-title">{t('settings.mcp')}</div>
      <div className="field">
        <label>{t('settings.mcp.enabled')}</label>
        <input
          type="checkbox"
          checked={settings.mcp.enabled}
          onChange={(e) => void setSetting('mcp', { ...settings.mcp, enabled: e.target.checked })}
        />
      </div>
      <div className="field">
        <label>{t('settings.mcp.port')}</label>
        <div className="ctl">
          <input
            type="number"
            min={1024}
            max={65535}
            value={mcpPort}
            onChange={(e) => setMcpPort(e.target.value)}
            onBlur={commitMcpPort}
          />
          <span
            style={{ color: mcp.error ? 'var(--danger)' : 'var(--fg-secondary)', fontSize: 11 }}
          >
            {mcp.error ?? (mcp.running ? mcp.url : 'off')}
          </span>
        </div>
      </div>

      <div className="section-title">{t('settings.update')}</div>
      <div className="field">
        <label>{t('settings.autoCheckUpdates')}</label>
        <input
          type="checkbox"
          checked={settings.autoCheckUpdates}
          onChange={(e) => void setSetting('autoCheckUpdates', e.target.checked)}
        />
      </div>

      <div className="section-title">{t('settings.location')}</div>
      <div className="field">
        <label>{t('settings.location.hint')}</label>
        <div className="ctl">
          <input
            type="number"
            placeholder="lat"
            step="any"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            onBlur={commitLocation}
          />
          <input
            type="number"
            placeholder="lng"
            step="any"
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            onBlur={commitLocation}
          />
        </div>
      </div>
    </Modal>
  )
}
