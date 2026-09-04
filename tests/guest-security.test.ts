import { describe, expect, it } from 'vitest'
import { isPrivateHost } from '../src/main/guest'

describe('guest certificate exception scope', () => {
  it('accepts only actual loopback and private IP addresses', () => {
    for (const host of [
      '127.0.0.1',
      '127.255.255.255',
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '0.0.0.0',
      '::1',
      '[::1]'
    ]) {
      expect(isPrivateHost(host), host).toBe(true)
    }
  })

  it('does not mistake public hostnames or adjacent IPv4 ranges for private addresses', () => {
    for (const host of [
      '127.attacker.example',
      '10.attacker.example',
      '172.16.attacker.example',
      '192.168.attacker.example',
      '172.15.255.255',
      '172.32.0.1',
      '192.167.255.255',
      '192.169.0.1'
    ]) {
      expect(isPrivateHost(host), host).toBe(false)
    }
  })

  it('keeps explicit local development hostnames in scope', () => {
    expect(isPrivateHost('localhost')).toBe(true)
    expect(isPrivateHost('app.localhost')).toBe(true)
    expect(isPrivateHost('devbox.local')).toBe(true)
    expect(isPrivateHost('not-local.example')).toBe(false)
  })
})
