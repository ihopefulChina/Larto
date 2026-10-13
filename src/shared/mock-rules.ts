/**
 * JSAPI mock rule engine, shaped after the official tool's guest-side mock
 * (extraResources/h5/preload.js; official tool reference §4.3):
 * a rule hits when `apiName` equals the invoked method AND every `paramRules`
 * entry matches its named parameter against `regExp`. On a hit the rule's
 * `response` is served directly and the real bridge is never touched.
 *
 * The rules live in settings (`mockRules`), are synced host → guest on bridge
 * ready / changes via the `mocks` channel message (or the official
 * `$syncMockList` invoke name), and are evaluated inside the guest preload.
 */

export interface MockParamRule {
  /** Parameter name. `String(value)` is tested; absent parameters test as ''. */
  name: string
  /** JS regular-expression source applied to the parameter value. */
  regExp: string
}

export interface MockResponse {
  status: 'success' | 'fail'
  /** The first entry's `json` is spread into the callback payload. */
  data: { type: string; json: Record<string, unknown> }[]
}

export interface MockRule {
  ruleName: string
  enable: boolean
  apiName: string
  paramRules: MockParamRule[]
  response: MockResponse
}

export interface MockHit {
  rule: MockRule
  /** Complete callback payload including `errMsg`. */
  payload: Record<string, unknown>
  ok: boolean
}

function paramMatches(rule: MockParamRule, params: Record<string, unknown>): boolean {
  const value = params[rule.name]
  try {
    return new RegExp(rule.regExp).test(value === undefined ? '' : String(value))
  } catch {
    return false
  }
}

/** First enabled rule whose apiName matches and every paramRule hits, or null. */
export function matchMockRule(
  rules: readonly MockRule[],
  method: string,
  params: Record<string, unknown>
): MockHit | null {
  for (const rule of rules) {
    if (!rule.enable || rule.apiName !== method) continue
    if (!rule.paramRules.every((p) => paramMatches(p, params))) continue
    const json = rule.response.data[0]?.json ?? {}
    const ok = rule.response.status !== 'fail'
    return {
      rule,
      ok,
      payload: { ...json, errMsg: `${method}:${ok ? 'ok' : 'fail'}` }
    }
  }
  return null
}

/**
 * Tolerant normaliser for rules coming from the settings editor: keeps the
 * official shape, drops malformed entries, fixes defaults. Returns a
 * structural-clone-safe array (plain objects only).
 */
export function parseMockRules(value: unknown): MockRule[] {
  if (!Array.isArray(value)) return []
  const out: MockRule[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const apiName = typeof r['apiName'] === 'string' ? r['apiName'].trim() : ''
    if (!apiName) continue
    const paramRules: MockParamRule[] = Array.isArray(r['paramRules'])
      ? r['paramRules']
          .map((p) => {
            const pr = (p ?? {}) as Record<string, unknown>
            return {
              name: typeof pr['name'] === 'string' ? pr['name'] : '',
              regExp: typeof pr['regExp'] === 'string' ? pr['regExp'] : ''
            }
          })
          .filter((p) => p.name || p.regExp)
      : []
    const rawResponse = (r['response'] ?? {}) as Record<string, unknown>
    const status = rawResponse['status'] === 'fail' ? 'fail' : 'success'
    const data: MockResponse['data'] = Array.isArray(rawResponse['data'])
      ? rawResponse['data']
          .map((d) => {
            const dr = (d ?? {}) as Record<string, unknown>
            let json: Record<string, unknown> = {}
            if (dr['json'] && typeof dr['json'] === 'object') json = { ...dr['json'] }
            else if (typeof dr['json'] === 'string') {
              try {
                const parsed: unknown = JSON.parse(dr['json'])
                if (parsed && typeof parsed === 'object') json = parsed as Record<string, unknown>
              } catch {
                /* keep {} */
              }
            }
            return { type: typeof dr['type'] === 'string' ? dr['type'] : 'json', json }
          })
          .slice(0, 1)
      : []
    out.push({
      ruleName:
        typeof r['ruleName'] === 'string' && r['ruleName'].trim() ? r['ruleName'].trim() : apiName,
      enable: r['enable'] !== false,
      apiName,
      paramRules,
      response: { status, data: data.length ? data : [{ type: 'json', json: {} }] }
    })
  }
  return out
}
