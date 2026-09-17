import { describe, expect, it } from 'vitest'
import { canCommitAccountWork, canStartAccountRefresh } from '../src/main/account-work'

const secrets = { session: 'a' }

describe('canCommitAccountWork', () => {
  it('allows a still-current signed-in refresh to persist its own secrets', () => {
    expect(
      canCommitAccountWork({
        startedGeneration: 3,
        currentGeneration: 3,
        startedSecrets: secrets,
        currentSecrets: secrets,
        status: 'signedIn'
      })
    ).toBe(true)
  })

  it('rejects a refresh that finished after logout, login, or a tenant switch', () => {
    expect(
      canCommitAccountWork({
        startedGeneration: 1,
        currentGeneration: 2,
        startedSecrets: secrets,
        currentSecrets: secrets,
        status: 'signedIn'
      })
    ).toBe(false)
    expect(
      canCommitAccountWork({
        startedGeneration: 1,
        currentGeneration: 1,
        startedSecrets: secrets,
        currentSecrets: { session: 'b' },
        status: 'signedIn'
      })
    ).toBe(false)
    expect(
      canCommitAccountWork({
        startedGeneration: 1,
        currentGeneration: 1,
        startedSecrets: secrets,
        currentSecrets: secrets,
        status: 'signedOut'
      })
    ).toBe(false)
    expect(
      canCommitAccountWork({
        startedGeneration: 1,
        currentGeneration: 1,
        startedSecrets: secrets,
        currentSecrets: secrets,
        status: 'signingIn'
      })
    ).toBe(false)
  })
})

describe('canStartAccountRefresh', () => {
  it('starts only when a signed-in or expired session already has secrets', () => {
    expect(canStartAccountRefresh({ status: 'signedIn', hasSecrets: true })).toBe(true)
    expect(canStartAccountRefresh({ status: 'expired', hasSecrets: true })).toBe(true)
  })

  it('does not bump work when login is open or there is no session', () => {
    expect(canStartAccountRefresh({ status: 'signingIn', hasSecrets: true })).toBe(false)
    expect(canStartAccountRefresh({ status: 'signedOut', hasSecrets: false })).toBe(false)
    expect(canStartAccountRefresh({ status: 'signedIn', hasSecrets: false })).toBe(false)
  })
})
