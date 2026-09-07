/**
 * Incremental Server-Sent Events parser. Feed it text chunks, get complete events back.
 * Only `data:` payloads matter for MCP (the server never uses `event:`/`id:` semantics we need).
 */
export class SseParser {
  #buffer = ''

  /** @param {string} chunk @returns {string[]} complete `data` payloads */
  push(chunk) {
    this.#buffer += chunk.replace(/\r\n/g, '\n')
    const events = []
    let sep
    while ((sep = this.#buffer.indexOf('\n\n')) !== -1) {
      const raw = this.#buffer.slice(0, sep)
      this.#buffer = this.#buffer.slice(sep + 2)
      const data = raw
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
      if (data.length) events.push(data.join('\n'))
    }
    return events
  }

  /** Flush a trailing event that was not terminated by a blank line. */
  end() {
    const rest = this.#buffer
    this.#buffer = ''
    if (!rest.trim()) return []
    return this.push(rest + '\n\n')
  }
}
