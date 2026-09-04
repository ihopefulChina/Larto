import { useEffect, useState } from 'react'
import type { FeishuEnv, Language, ProxySettings, ThemeMode } from '@shared/settings'
import { useApp, useT } from '@/store/app'
import { Modal } from '../Modal'

export function SettingsModal() {
  const t = useT()
  const settings = useApp((s) => s.settings)
  const info = useApp((s) => s.info)
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

  useEffect(() => setProxy(settings.proxy), [settings.proxy])

  const commitProxy = (next: ProxySettings) => {
    setProxy(next)
    void setSetting('proxy', next).catch(() => {
      setProxy(settings.proxy)
      useApp.getState().showToast(t('settings.proxy.urlRequired'))
    })
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
    // Half-filled pair: wait for the other field (Number('') would silently become 0).
    else if (lat !== '' && lng !== '' && Number.isFinite(la) && Number.isFinite(ln))
      void setSetting('mockLocation', { latitude: la, longitude: ln })
  }

  const seg = <V extends string>(
    labelledBy: string,
    value: V,
    options: [V, string][],
    onChange: (v: V) => void
  ) => (
    <div className="segmented" role="radiogroup" aria-labelledby={labelledBy}>
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          className={v === value ? 'active' : ''}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  )

  return (
    <Modal title={t('settings.title')} width={620} className="settings">
      <div className="settingsPage">
        {info?.accountStorage === 'memoryOnly' && (
          <div className="settingsStorageWarning" role="status">
            <span aria-hidden="true">!</span>
            <div>
              <strong>{t('settings.accountStorage.memoryOnlyTitle')}</strong>
              <p>{t('settings.accountStorage.memoryOnly')}</p>
            </div>
          </div>
        )}
        <section className="settingsSection" aria-labelledby="settings-general">
          <h3 id="settings-general" className="section-title">
            {t('settings.general')}
          </h3>
          <div className="settingsRows">
            <div className="field">
              <span id="set-appearance">{t('settings.appearance')}</span>
              {seg<ThemeMode>(
                'set-appearance',
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
              <span id="set-language">{t('settings.language')}</span>
              {seg<Language>(
                'set-language',
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
              <span id="set-env">{t('settings.env')}</span>
              {seg<FeishuEnv>(
                'set-env',
                settings.env,
                [
                  ['feishu', t('settings.env.feishu')],
                  ['lark', t('settings.env.lark')]
                ],
                (v) => void setSetting('env', v)
              )}
            </div>
          </div>
        </section>

        <section className="settingsSection" aria-labelledby="settings-proxy">
          <h3 id="settings-proxy" className="section-title">
            {t('settings.proxy')}
          </h3>
          <div className="settingsRows">
            <div className="field">
              <span id="set-proxy">{t('settings.proxy')}</span>
              {seg<ProxySettings['mode']>(
                'set-proxy',
                proxy.mode,
                [
                  ['system', t('settings.proxy.system')],
                  ['none', t('settings.proxy.none')],
                  ['manual', t('settings.proxy.manual')]
                ],
                (mode) => {
                  const next = { ...proxy, mode }
                  setProxy(next)
                  // "Manual" with no address is an editable draft, not a request to silently use
                  // the system proxy. Commit after the address is valid.
                  if (mode !== 'manual' || next.url.trim()) commitProxy(next)
                }
              )}
            </div>
            {proxy.mode === 'manual' && (
              <>
                <div className="field">
                  <label htmlFor="set-proxy-url">{t('settings.proxy.url')}</label>
                  <div className="fieldControl">
                    <input
                      id="set-proxy-url"
                      type="text"
                      placeholder="http://127.0.0.1:7890"
                      value={proxy.url}
                      onChange={(e) => setProxy({ ...proxy, url: e.target.value })}
                      onBlur={() => {
                        const next = { ...proxy, url: proxy.url.trim() }
                        if (next.url) commitProxy(next)
                        else {
                          setProxy(settings.proxy)
                          useApp.getState().showToast(t('settings.proxy.urlRequired'))
                        }
                      }}
                      required
                      aria-invalid={!proxy.url.trim()}
                      aria-describedby="set-proxy-url-error"
                    />
                    {!proxy.url.trim() && (
                      <span id="set-proxy-url-error" className="fieldValidation" role="alert">
                        {t('settings.proxy.urlRequired')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="set-proxy-bypass">{t('settings.proxy.bypass')}</label>
                  <input
                    id="set-proxy-bypass"
                    type="text"
                    value={proxy.bypass}
                    onChange={(e) => setProxy({ ...proxy, bypass: e.target.value })}
                    onBlur={() => commitProxy(proxy)}
                  />
                </div>
              </>
            )}
          </div>
        </section>

        <section className="settingsSection" aria-labelledby="settings-mcp">
          <h3 id="settings-mcp" className="section-title">
            {t('settings.mcp')}
          </h3>
          <div className="settingsRows">
            <div className="field">
              <label htmlFor="set-mcp">{t('settings.mcp.enabled')}</label>
              <input
                id="set-mcp"
                type="checkbox"
                checked={settings.mcp.enabled}
                onChange={(e) =>
                  void setSetting('mcp', { ...settings.mcp, enabled: e.target.checked })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="set-mcp-port">{t('settings.mcp.port')}</label>
              <div className="ctl mcpStatus">
                <input
                  id="set-mcp-port"
                  type="number"
                  min={1024}
                  max={65535}
                  value={mcpPort}
                  onChange={(e) => setMcpPort(e.target.value)}
                  onBlur={commitMcpPort}
                />
                <span className={mcp.error ? 'error' : ''}>
                  {mcp.error ?? (mcp.running ? mcp.url : 'off')}
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="settingsSection" aria-labelledby="settings-update">
          <h3 id="settings-update" className="section-title">
            {t('settings.update')}
          </h3>
          <div className="settingsRows">
            <div className="field">
              <label htmlFor="set-autoupdate">{t('settings.autoCheckUpdates')}</label>
              <input
                id="set-autoupdate"
                type="checkbox"
                checked={settings.autoCheckUpdates}
                onChange={(e) => void setSetting('autoCheckUpdates', e.target.checked)}
              />
            </div>
          </div>
        </section>

        <section className="settingsSection" aria-labelledby="settings-location">
          <div className="settingsSectionHead">
            <h3 id="settings-location" className="section-title">
              {t('settings.location')}
            </h3>
            <p>{t('settings.location.hint')}</p>
          </div>
          <div className="settingsRows">
            <div className="field locationField">
              <label htmlFor="set-location-lat">{t('settings.lat')}</label>
              <input
                id="set-location-lat"
                type="number"
                inputMode="decimal"
                placeholder={t('settings.latPlaceholder')}
                step="any"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                onBlur={commitLocation}
              />
            </div>
            <div className="field locationField">
              <label htmlFor="set-location-lng">{t('settings.lng')}</label>
              <input
                id="set-location-lng"
                type="number"
                inputMode="decimal"
                placeholder={t('settings.lngPlaceholder')}
                step="any"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                onBlur={commitLocation}
              />
            </div>
          </div>
        </section>
      </div>
    </Modal>
  )
}
