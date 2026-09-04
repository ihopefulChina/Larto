import { createInterface } from 'node:readline'
import { SseParser } from './sse.mjs'

/**
 * stdio ⇄ Streamable HTTP bridge.
 *
 * The MCP client speaks newline-delimited JSON-RPC on our stdin/stdout; every message is POSTed
 * to the app's `/mcp` endpoint and whatever comes back (a JSON body or an SSE stream of JSON-RPC
 * messages) is written to stdout one message per line. The app's server is stateless, so requests
 * are independent and can be in flight concurrently; the session id / protocol version headers
 * are still echoed back in case a future version becomes stateful.
 */
export function runBridge({
  url,
  input = process.stdin,
  output = process.stdout,
  log = () => {},
  requestTimeoutMs = 60_000
}) {
  let sessionId = null
  let protocolVersion = null
  const inflight = new Set()

  const write = (msg) => {
    output.write(JSON.stringify(msg) + '\n')
  }

  const handleServerMessage = (text, onMessage = () => {}) => {
    let msg
    try {
      msg = JSON.parse(text)
    } catch {
      log(`dropping non-JSON frame from server: ${text.slice(0, 200)}`)
      return false
    }
    for (const item of Array.isArray(msg) ? msg : [msg]) {
      if (
        item &&
        item.result &&
        typeof item.result.protocolVersion === 'string' &&
        typeof item.result.serverInfo === 'object'
      ) {
        protocolVersion = item.result.protocolVersion
      }
    }
    onMessage(msg)
    write(msg)
    return true
  }

  const forward = async (line) => {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      write({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' }
      })
      return
    }
    const ids = (Array.isArray(msg) ? msg : [msg])
      .filter((m) => m && m.id !== undefined && m.id !== null && m.method !== undefined)
      .map((m) => m.id)
    const pendingIds = new Set(ids)
    const markCompleted = (serverMessage) => {
      for (const item of Array.isArray(serverMessage) ? serverMessage : [serverMessage]) {
        if (
          item &&
          typeof item === 'object' &&
          pendingIds.has(item.id) &&
          (Object.hasOwn(item, 'result') || Object.hasOwn(item, 'error'))
        ) {
          pendingIds.delete(item.id)
        }
      }
    }
    const failPending = (message) => {
      for (const id of pendingIds) {
        write({ jsonrpc: '2.0', id, error: { code: -32000, message } })
      }
      pendingIds.clear()
    }
    const controller = new AbortController()
    const timeoutMessage = `Request to ${url} timed out after ${requestTimeoutMs}ms`
    const timeout = setTimeout(() => controller.abort(new Error(timeoutMessage)), requestTimeoutMs)
    try {
      const headers = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      }
      if (sessionId) headers['mcp-session-id'] = sessionId
      if (protocolVersion) headers['mcp-protocol-version'] = protocolVersion
      let res
      try {
        res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(msg),
          signal: controller.signal
        })
      } catch (err) {
        failPending(
          controller.signal.aborted
            ? timeoutMessage
            : `FeishuDevTools is not reachable at ${url} (${err.message ?? err}). Is the app running?`
        )
        return
      }
      const sid = res.headers.get('mcp-session-id')
      if (sid) sessionId = sid
      if (res.status === 202 || res.status === 204) {
        failPending(`HTTP ${res.status} from ${url} returned no JSON-RPC response`)
        return
      }
      if (!res.ok) {
        let body
        try {
          body = await res.text()
        } catch (err) {
          failPending(
            controller.signal.aborted
              ? timeoutMessage
              : `HTTP ${res.status} response from ${url} could not be read (${err?.message ?? err})`
          )
          return
        }
        let parsed = null
        try {
          parsed = JSON.parse(body)
        } catch {
          /* not JSON */
        }
        for (const id of ids) {
          write(
            parsed && parsed.error
              ? { jsonrpc: '2.0', id, error: parsed.error }
              : {
                  jsonrpc: '2.0',
                  id,
                  error: {
                    code: -32000,
                    message: `HTTP ${res.status} from ${url}: ${body.slice(0, 300)}`
                  }
                }
          )
        }
        return
      }
      const type = res.headers.get('content-type') ?? ''
      if (type.includes('text/event-stream')) {
        const parser = new SseParser()
        const decoder = new TextDecoder()
        try {
          if (!res.body) throw new Error('response body is missing')
          for await (const chunk of res.body) {
            for (const data of parser.push(decoder.decode(chunk, { stream: true })))
              handleServerMessage(data, markCompleted)
          }
          const tail = decoder.decode()
          if (tail) {
            for (const data of parser.push(tail)) handleServerMessage(data, markCompleted)
          }
          for (const data of parser.end()) handleServerMessage(data, markCompleted)
        } catch (err) {
          log(`SSE response failed: ${err?.stack ?? err}`)
          failPending(
            controller.signal.aborted
              ? timeoutMessage
              : `SSE response from ${url} was interrupted (${err?.message ?? err})`
          )
          return
        }
        failPending(
          controller.signal.aborted
            ? timeoutMessage
            : `SSE response from ${url} ended before the request completed`
        )
        return
      }
      let text
      try {
        text = await res.text()
      } catch (err) {
        log(`response body read failed: ${err?.stack ?? err}`)
        failPending(
          controller.signal.aborted
            ? timeoutMessage
            : `Response from ${url} could not be read (${err?.message ?? err})`
        )
        return
      }
      if (!text.trim()) {
        failPending(controller.signal.aborted ? timeoutMessage : `Empty response from ${url}`)
        return
      }
      let body
      try {
        body = JSON.parse(text)
      } catch {
        log(`non-JSON response body: ${text.slice(0, 200)}`)
        failPending(controller.signal.aborted ? timeoutMessage : `Non-JSON response from ${url}`)
        return
      }
      for (const m of Array.isArray(body) ? body : [body]) {
        markCompleted(m)
        write(m)
      }
      failPending(
        controller.signal.aborted
          ? timeoutMessage
          : `JSON response from ${url} did not complete the request`
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  return new Promise((resolve) => {
    const rl = createInterface({ input, crlfDelay: Infinity })
    rl.on('line', (line) => {
      if (!line.trim()) return
      const p = forward(line).catch((err) => log(`forward failed: ${err?.stack ?? err}`))
      inflight.add(p)
      p.finally(() => inflight.delete(p))
    })
    rl.on('close', () => {
      Promise.allSettled([...inflight]).then(() => resolve())
    })
  })
}
