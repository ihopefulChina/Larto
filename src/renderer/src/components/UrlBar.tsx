import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { MAX_URL_LENGTH } from '@shared/settings'
import { translate } from '@shared/i18n'
import { displayUrl, normalizeUrl } from '@shared/url'
import { invoke } from '@/lib/bridge'
import { popoverShield } from '@/lib/popoverShield'
import { useApp, useCoversDevTools, useT } from '@/store/app'
import { simulatorActions, useSimulator } from '@/store/simulator'
import { ChevronDown, RefreshIcon } from './icons'

/** Called by the toolbar and by menu/MCP `navigate` commands so history stays in sync. */
export async function navigateTo(raw: string): Promise<void> {
  const url = normalizeUrl(raw)
  if (!url) {
    const app = useApp.getState()
    app.showToast(translate(app.lang, 'toolbar.invalidUrl'))
    return
  }
  const current = useSimulator.getState().url
  if (url === current) {
    simulatorActions.reload()
  } else {
    // Failed navigations (dead dev servers, DNS errors) used to fail silently: the address bar
    // kept the old URL and nothing else happened, which read as "selecting history does
    // nothing". Abort just means the load was superseded or redirected — not an error toast.
    void simulatorActions.loadUrlAndWait(url).catch((err) => {
      if (!String(err).includes('ERR_ABORTED')) {
        const app = useApp.getState()
        app.showToast(translate(app.lang, 'toolbar.navFailed'))
      }
    })
  }
  const history = await invoke('settings:pushHistory', url)
  useApp.setState((s) => ({ settings: { ...s.settings, urlHistory: history, lastUrl: url } }))
}

export function UrlBar({ focusSignal }: { focusSignal: number }) {
  const t = useT()
  const currentUrl = useSimulator((s) => s.url)
  const loading = useSimulator((s) => s.loading)
  const history = useApp((s) => s.settings.urlHistory)
  const [value, setValue] = useState('')
  const [editing, setEditing] = useState(false)
  /** True once the user has typed in this editing session; only then does the list filter. */
  const [typed, setTyped] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const historyId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  useCoversDevTools(open, historyRef)

  // Combobox behaviour: the list narrows to what was typed. Merely focusing the bar (value is
  // the current URL) still shows the full history.
  const query = typed ? value.trim().toLowerCase() : ''
  const items = useMemo(
    () => (query ? history.filter((h) => h.toLowerCase().includes(query)) : history),
    [history, query]
  )

  useEffect(() => {
    if (!editing) setValue(displayUrl(currentUrl))
  }, [currentUrl, editing])

  useEffect(() => {
    if (focusSignal > 0) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [focusSignal])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  // While the list is open the guest surface must not swallow the pointer (see popoverShield).
  useEffect(() => {
    if (!open) return
    popoverShield(true)
    return () => popoverShield(false)
  }, [open])

  const submit = (raw: string) => {
    setOpen(false)
    setActive(-1)
    setTyped(false)
    inputRef.current?.blur()
    void navigateTo(raw)
  }

  return (
    <div ref={boxRef} className="urlbox" aria-busy={loading}>
      <button
        type="button"
        className="tbtn icon"
        title={t('toolbar.refresh')}
        aria-label={t('toolbar.refresh')}
        onClick={() => simulatorActions.reload()}
        disabled={!currentUrl}
      >
        <RefreshIcon
          aria-hidden
          style={loading ? { animation: 'spin 0.7s linear infinite' } : undefined}
        />
      </button>
      <span className="urlProgress" aria-hidden />
      <input
        ref={inputRef}
        value={value}
        maxLength={MAX_URL_LENGTH}
        placeholder={t('toolbar.urlPlaceholder')}
        spellCheck={false}
        role="combobox"
        aria-label={t('toolbar.urlPlaceholder')}
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-controls={historyId}
        aria-activedescendant={open && active >= 0 ? `${historyId}-option-${active}` : undefined}
        aria-expanded={open}
        onFocus={() => {
          setEditing(true)
          setOpen(true)
        }}
        onBlur={(e) => {
          setEditing(false)
          setTyped(false)
          // Clicking a list entry keeps focus here (mousedown preventDefault), so a blur that
          // does leave the box means the user went elsewhere: collapse the list with it.
          if (!boxRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false)
        }}
        onClick={() => {
          // After closing via the chevron the input keeps focus, so onFocus never fires again;
          // an explicit click must reopen the list.
          if (!open) setOpen(true)
        }}
        onChange={(e) => {
          setValue(e.target.value)
          setTyped(true)
          setOpen(true)
          setActive(-1)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const pick = active >= 0 ? items[active] : undefined
            submit(pick ?? value)
          } else if (e.key === 'ArrowDown' && items.length) {
            e.preventDefault()
            setOpen(true)
            setActive((a) => Math.min(items.length - 1, a + 1))
          } else if (e.key === 'ArrowUp' && items.length) {
            e.preventDefault()
            setActive((a) => Math.max(-1, a - 1))
          } else if (e.key === 'Escape') {
            setOpen(false)
            inputRef.current?.blur()
          }
        }}
      />
      <button
        type="button"
        className="tbtn icon right"
        title={t('toolbar.history')}
        aria-label={t('toolbar.history')}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={historyId}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) {
            setOpen(false)
          } else {
            // Focus the input as well so ArrowDown/Enter work right away; onFocus also reopens.
            inputRef.current?.focus()
            setOpen(true)
          }
        }}
      >
        <ChevronDown aria-hidden />
      </button>
      {open && (
        <div ref={historyRef} className="history">
          <div className="history-head">
            <span>{t('toolbar.history')}</span>
            {history.length > 0 && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => useApp.getState().openModal('clearHistory')}
              >
                {t('toolbar.clearHistory')}
              </button>
            )}
          </div>
          <div id={historyId} role="listbox" aria-label={t('toolbar.history')}>
            {items.length === 0 ? (
              <div className="history-empty">
                {history.length === 0 ? t('toolbar.historyEmpty') : t('toolbar.historyNoMatch')}
              </div>
            ) : (
              items.map((h, i) => {
                const parts = splitHistoryUrl(h)
                return (
                  <button
                    id={`${historyId}-option-${i}`}
                    key={h}
                    className={`history-item ${i === active ? 'active' : ''}`}
                    role="option"
                    aria-selected={i === active}
                    title={h}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => submit(h)}
                  >
                    <span className="history-host">{parts.host}</span>
                    {parts.path && <span className="history-path">{parts.path}</span>}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function splitHistoryUrl(raw: string): { host: string; path: string } {
  try {
    const url = new URL(raw)
    const path = `${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`
    return { host: url.host || raw, path }
  } catch {
    return { host: raw, path: '' }
  }
}
