import { describe, it, expect } from 'vitest'
import { countActiveApiKeys, wouldViolateLastActiveKeyInvariant } from '@app/api-key/last-active-key-guard'
import { ApiKeyEntity } from '@titvo/auth'

function apiKey (overrides: Partial<ApiKeyEntity>): ApiKeyEntity {
  return {
    keyId: 'key-x',
    userId: 'user-x',
    apiKey: 'deadbeef',
    label: 'ci',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'admin@titvo.dev',
    ...overrides
  }
}

describe('countActiveApiKeys', () => {
  it('counts keys whose status is not "revoked", treating a missing status as active (D5 backward-compat)', () => {
    const keys: ApiKeyEntity[] = [
      apiKey({ keyId: 'k1', status: 'active' }),
      apiKey({ keyId: 'k2', status: undefined }),
      apiKey({ keyId: 'k3', status: 'revoked' })
    ]

    expect(countActiveApiKeys(keys)).toBe(2)
  })

  it('returns 0 for a set with no active keys', () => {
    const keys: ApiKeyEntity[] = [
      apiKey({ keyId: 'k1', status: 'revoked' })
    ]

    expect(countActiveApiKeys(keys)).toBe(0)
  })
})

describe('wouldViolateLastActiveKeyInvariant', () => {
  it('returns true when the target is the sole active key', () => {
    const keys: ApiKeyEntity[] = [
      apiKey({ keyId: 'k1', status: 'active' }),
      apiKey({ keyId: 'k2', status: 'revoked' })
    ]

    expect(wouldViolateLastActiveKeyInvariant(keys, 'k1')).toBe(true)
  })

  it('returns false when another active key remains', () => {
    const keys: ApiKeyEntity[] = [
      apiKey({ keyId: 'k1', status: 'active' }),
      apiKey({ keyId: 'k2', status: 'active' })
    ]

    expect(wouldViolateLastActiveKeyInvariant(keys, 'k1')).toBe(false)
  })

  it('returns false when the target is not currently active (already revoked) — idempotent revoke is not a violation', () => {
    const keys: ApiKeyEntity[] = [
      apiKey({ keyId: 'k1', status: 'revoked' }),
      apiKey({ keyId: 'k2', status: 'active' })
    ]

    expect(wouldViolateLastActiveKeyInvariant(keys, 'k1')).toBe(false)
  })

  it('returns false when the target key is not found in the snapshot', () => {
    const keys: ApiKeyEntity[] = [
      apiKey({ keyId: 'k1', status: 'active' })
    ]

    expect(wouldViolateLastActiveKeyInvariant(keys, 'unknown')).toBe(false)
  })

  it('treats a missing status on the target as active for the invariant check', () => {
    const keys: ApiKeyEntity[] = [
      apiKey({ keyId: 'k1', status: undefined })
    ]

    expect(wouldViolateLastActiveKeyInvariant(keys, 'k1')).toBe(true)
  })
})
