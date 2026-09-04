/**
 * Keep operational error logs useful without persisting server messages, response bodies, URLs,
 * or arbitrary rejection values that may contain account or tenant data.
 */
export interface SafeErrorSummary {
  kind: string
  code?: number | string
  status?: number
}

const SAFE_ERROR_KIND = /^[A-Za-z][A-Za-z0-9]{0,47}$/
const SAFE_SYSTEM_CODE = /^[A-Z][A-Z0-9_-]{0,31}$/

export function summarizeErrorForLog(err: unknown): SafeErrorSummary {
  const source = err && typeof err === 'object' ? (err as Record<string, unknown>) : null
  const candidateKind = err instanceof Error ? err.name : ''
  const summary: SafeErrorSummary = {
    kind: SAFE_ERROR_KIND.test(candidateKind)
      ? candidateKind
      : err instanceof Error
        ? 'Error'
        : 'unknown'
  }
  const code = source?.['code']
  if (typeof code === 'number' && Number.isFinite(code)) summary.code = code
  else if (typeof code === 'string' && SAFE_SYSTEM_CODE.test(code)) summary.code = code
  const status = source?.['status']
  if (typeof status === 'number' && Number.isInteger(status)) summary.status = status
  return summary
}
