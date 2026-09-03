import { useEffect, useRef, useState } from 'react'
import { MAX_URL_LENGTH } from '@shared/settings'
import { displayUrl, normalizeUrl } from '@shared/url'
import { invoke } from '@/lib/bridge'
import { useApp, useT } from '@/store/app'
import { simulatorActions, useSimulator } from '@/store/simulator'
import { ChevronDown, RefreshIcon } from './icons'

/** Called by the toolbar and by menu/MCP `navigate` commands so history stays in sync. */
export async function navigateTo(raw: string): Promise<void> {
  const url = normalizeUrl(raw)
  if (!url) return
  const current = useSimulator.getState().url
  if (url === current) simulatorActions.reload()
  else simulatorActions.loadUrl(url)
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
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

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

  const submit = (raw: string) => {
    setOpen(false)
    setActive(-1)
    inputRef.current?.blur()
    void navigateTo(raw)
  }

  return (
    <div ref={boxRef} className="urlbox">
      <button
        className="tbtn icon"
        title={t('toolbar.refresh')}
        onClick={() => simulatorActions.reload()}
        disabled={!currentUrl}
      >
        <RefreshIcon style={loading ? { animation: 'spin 1s linear infinite' } : undefined} />
      </button>
      <input
        ref={inputRef}
        value={value}
        maxLength={MAX_URL_LENGTH}
        placeholder={t('toolbar.urlPlaceholder')}
        spellCheck={false}
        onFocus={() => {
          setEditing(true)
          setOpen(true)
        }}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          setValue(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const pick = active >= 0 ? history[active] : undefined
            submit(pick ?? value)
          } else if (e.key === 'ArrowDown' && history.length) {
            e.preventDefault()
            setOpen(true)
            setActive((a) => Math.min(history.length - 1, a + 1))
          } else if (e.key === 'ArrowUp' && history.length) {
            e.preventDefault()
            setActive((a) => Math.max(-1, a - 1))
          } else if (e.key === 'Escape') {
            setOpen(false)
            inputRef.current?.blur()
          }
        }}
      />
      <button
        className="tbtn icon right"
        title={t('toolbar.history')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown />
      </button>
      {open && (
        <div className="history">
          <div className="history-head">
            <span>{t('toolbar.history')}</span>
            {history.length > 0 && (
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  void invoke('settings:clearHistory').then((h) =>
                    useApp.setState((s) => ({ settings: { ...s.settings, urlHistory: h } }))
                  )
                }}
              >
                {t('toolbar.clearHistory')}
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <div className="history-empty">—</div>
          ) : (
            history.map((h, i) => (
              <button
                key={h}
                className={`history-item ${i === active ? 'active' : ''}`}
                title={h}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => submit(h)}
              >
                {h}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
