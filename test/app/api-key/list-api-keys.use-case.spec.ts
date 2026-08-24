import { describe, expect, it, vi } from 'vitest'
import { ApiKeyRepository, ApiKeyEntity } from '@titvo/auth'
import { ListApiKeysUseCase } from '@app/api-key/list-api-keys.use-case'

function buildApiKeyRepository (findAll: () => Promise<ApiKeyEntity[]>): ApiKeyRepository {
  return { findAll } as unknown as ApiKeyRepository
}

describe('ListApiKeysUseCase', () => {
  it('returns an empty array when there are no keys', async () => {
    const useCase = new ListApiKeysUseCase(buildApiKeyRepository(async () => []))

    expect(await useCase.execute()).toEqual([])
  })

  it('returns metadata for every key: label, status, createdAt, createdBy, lastUsedAt, revokedAt', async () => {
    const entity: ApiKeyEntity = {
      keyId: 'k1',
      userId: 'admin-1',
      apiKey: 'hashed-secret-value',
      label: 'ci-runner',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'admin@titvo.dev'
    }
    const useCase = new ListApiKeysUseCase(buildApiKeyRepository(async () => [entity]))

    const result = await useCase.execute()

    expect(result).toEqual([{
      keyId: 'k1',
      label: 'ci-runner',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'admin@titvo.dev',
      lastUsedAt: undefined,
      revokedAt: undefined
    }])
  })

  it('NEVER includes the hash or any raw-looking key field on any returned item (security: hash-free by construction)', async () => {
    const entity: ApiKeyEntity = {
      keyId: 'k1',
      userId: 'admin-1',
      apiKey: 'super-secret-hash-value-should-never-leak',
      status: 'active'
    }
    const useCase = new ListApiKeysUseCase(buildApiKeyRepository(async () => [entity]))

    const result = await useCase.execute()

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('super-secret-hash-value-should-never-leak')
    expect(result[0]).not.toHaveProperty('apiKey')
    expect(result[0]).not.toHaveProperty('userId')
    expect(Object.keys(result[0]).sort()).toEqual(['createdAt', 'createdBy', 'keyId', 'label', 'lastUsedAt', 'revokedAt', 'status'].sort())
  })
})
