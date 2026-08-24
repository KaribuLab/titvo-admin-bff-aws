import { describe, it, expect, vi } from 'vitest'
import { ApiKeyRepository, ApiKeyEntity, ApiKeyNotFoundError } from '@titvo/auth'
import { RevokeApiKeyUseCase } from '@app/api-key/revoke-api-key.use-case'
import { LastActiveKeyError } from '@app/api-key/api-key.error'

function key (overrides: Partial<ApiKeyEntity>): ApiKeyEntity {
  return {
    keyId: 'key-x',
    userId: 'admin-1',
    apiKey: 'hash-x',
    status: 'active',
    ...overrides
  }
}

function buildRepository (): ApiKeyRepository {
  return {
    findByUserId: vi.fn(),
    findByApiKey: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    revoke: vi.fn(),
    activate: vi.fn()
  } as unknown as ApiKeyRepository
}

describe('RevokeApiKeyUseCase', () => {
  it('revokes a key when another active key remains', async () => {
    const repository = buildRepository()
    const k1 = key({ keyId: 'k1' })
    const k2 = key({ keyId: 'k2' })
    vi.spyOn(repository, 'findAll')
      .mockResolvedValueOnce([k1, k2])
      .mockResolvedValueOnce([{ ...k1, status: 'revoked' }, k2])
    vi.spyOn(repository, 'revoke').mockResolvedValue({ ...k1, status: 'revoked' })
    const useCase = new RevokeApiKeyUseCase(repository)

    const result = await useCase.execute('k1')

    expect(repository.revoke).toHaveBeenCalledWith('k1')
    expect(result.status).toBe('revoked')
    expect(repository.activate).not.toHaveBeenCalled()
  })

  it('rejects revoking the sole active key with LastActiveKeyError, without writing (risk resolution #1)', async () => {
    const repository = buildRepository()
    vi.spyOn(repository, 'findAll').mockResolvedValue([key({ keyId: 'k1' })])
    const useCase = new RevokeApiKeyUseCase(repository)

    await expect(useCase.execute('k1')).rejects.toThrow(LastActiveKeyError)
    expect(repository.revoke).not.toHaveBeenCalled()
  })

  it('rolls back the write when a concurrent race leaves zero active keys post-write', async () => {
    // Pre-check sees two active keys (k1, k2), passes. Between pre-check
    // and write, a concurrent request revokes k2. Post-write re-count
    // must catch this and roll k1's revoke back.
    const repository = buildRepository()
    const k1 = key({ keyId: 'k1' })
    const k2 = key({ keyId: 'k2' })
    vi.spyOn(repository, 'findAll')
      .mockResolvedValueOnce([k1, k2]) // pre-check: 2 active, passes
      .mockResolvedValueOnce([{ ...k1, status: 'revoked' }, { ...k2, status: 'revoked' }]) // post-write: raced, 0 active
    vi.spyOn(repository, 'revoke').mockResolvedValue({ ...k1, status: 'revoked' })
    const useCase = new RevokeApiKeyUseCase(repository)

    await expect(useCase.execute('k1')).rejects.toThrow(LastActiveKeyError)

    expect(repository.revoke).toHaveBeenCalledWith('k1')
    expect(repository.activate).toHaveBeenCalledWith('k1')
    expect(repository.activate).toHaveBeenCalledTimes(1)
  })

  it('is idempotent on an already-revoked key: returns 200-equivalent without re-checking the invariant or writing', async () => {
    const repository = buildRepository()
    const alreadyRevoked = key({ keyId: 'k1', status: 'revoked' })
    vi.spyOn(repository, 'findAll').mockResolvedValue([alreadyRevoked])
    const useCase = new RevokeApiKeyUseCase(repository)

    const result = await useCase.execute('k1')

    expect(result.status).toBe('revoked')
    expect(repository.revoke).not.toHaveBeenCalled()
  })

  it('throws ApiKeyNotFoundError when the target key does not exist', async () => {
    const repository = buildRepository()
    vi.spyOn(repository, 'findAll').mockResolvedValue([key({ keyId: 'k1' })])
    const useCase = new RevokeApiKeyUseCase(repository)

    await expect(useCase.execute('missing')).rejects.toThrow(ApiKeyNotFoundError)
    expect(repository.revoke).not.toHaveBeenCalled()
  })
})
