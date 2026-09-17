/** Account statuses that must never be overwritten by a stale `refresh()` / `loadAccount`. */
export type AccountCommitStatus = 'signedOut' | 'signingIn' | 'signedIn' | 'expired'

/** A no-op refresh must not bump generation, or an in-flight QR login is discarded. */
export function canStartAccountRefresh(input: {
  status: AccountCommitStatus
  hasSecrets: boolean
}): boolean {
  return input.hasSecrets && input.status !== 'signedOut' && input.status !== 'signingIn'
}

/**
 * After every `await`, a profile write is only legal if this call still owns the generation,
 * still holds the same in-memory secrets, and the user has not logged out or started a new login.
 */
export function canCommitAccountWork(input: {
  startedGeneration: number
  currentGeneration: number
  startedSecrets: object | null
  currentSecrets: object | null
  status: AccountCommitStatus
}): boolean {
  return (
    input.startedGeneration === input.currentGeneration &&
    input.startedSecrets !== null &&
    input.startedSecrets === input.currentSecrets &&
    input.status !== 'signedOut' &&
    input.status !== 'signingIn'
  )
}
