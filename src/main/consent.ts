import { randomUUID } from 'node:crypto'
import type { AccessConsentInfo } from '@shared/ipc'
import { createLogger } from './logger'
import { getMainWindow, sendToRenderer } from './window'

const log = createLogger('consent')

/** Same budget as the official login window (§4): a forgotten dialog must not hang the page. */
export const CONSENT_TIMEOUT_MS = 180_000

interface Pending {
  resolve: (accept: boolean) => void
  timer: NodeJS.Timeout
  cleanup: () => void
}

/**
 * Bridges `requestAccess` (main, waiting on the JSAPI promise) and the consent dialog
 * (shell renderer). One prompt per id; a new prompt cancels any dialog still open so the
 * page never receives a stale answer.
 */
export class ConsentBroker {
  private pending = new Map<string, Pending>()

  ask(info: AccessConsentInfo): Promise<boolean> {
    for (const id of this.pending.keys()) this.settle(id, false)
    const win = getMainWindow()
    if (!win) return Promise.resolve(false)
    const id = randomUUID()
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        log.warn(`consent ${id} timed out`)
        this.settle(id, false)
      }, CONSENT_TIMEOUT_MS)
      timer.unref()
      const onClosed = () => this.settle(id, false)
      win.once('closed', onClosed)
      this.pending.set(id, { resolve, timer, cleanup: () => win.off('closed', onClosed) })
      sendToRenderer('jsapi:consent', { id, info })
    })
  }

  /** Renderer decision. Unknown ids (timed out, superseded) are ignored. */
  decide(id: string, accept: boolean): void {
    if (!this.pending.has(id)) return
    log.info(`consent ${id}: ${accept ? 'accepted' : 'refused'}`)
    this.settle(id, accept)
  }

  get hasPending(): boolean {
    return this.pending.size > 0
  }

  private settle(id: string, accept: boolean): void {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    clearTimeout(p.timer)
    p.cleanup()
    p.resolve(accept)
  }
}

export const consentBroker = new ConsentBroker()
