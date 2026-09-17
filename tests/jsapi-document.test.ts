import { describe, expect, it } from 'vitest'
import { createJsapiDocumentGuard } from '../src/renderer/src/jsapi/document'

describe('createJsapiDocumentGuard', () => {
  it('drops results stamped before a navigation', () => {
    const documents = createJsapiDocumentGuard()
    const first = documents.current()
    expect(documents.isCurrent(first)).toBe(true)
    documents.begin()
    expect(documents.isCurrent(first)).toBe(false)
    expect(documents.isCurrent(documents.current())).toBe(true)
  })
})
