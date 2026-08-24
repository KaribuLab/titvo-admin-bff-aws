import { describe, expect, it, vi } from 'vitest'
import { ApiKeyRepository, ApiKeyEntity } from '@titvo/auth'
import { CreateApiKeyUseCase } from '@app/api-key/create-api-key.use-case'

function buildApiKeyRepository (create: (entity: ApiKeyEntity) => Promise<ApiKeyEntity>): ApiKeyRepository {
  return { create } as unknown as ApiKeyRepository
}

describe('CreateApiKeyUseCase', () => {
  it('persists only the SHA-256 hash of the generated key, never the raw value', async () => {
    const createSpy = vi.fn(async (entity: ApiKeyEntity) => entity)
    const useCase = new CreateApiKeyUseCase(buildApiKeyRepository(createSpy))

    await useCase.execute('ci-runner', 'admin-1', 'admin@titvo.dev')

    expect(createSpy).toHaveBeenCalledTimes(1)
    const persisted = createSpy.mock.calls[0][0]
    expect(persisted.apiKey).toMatch(/^[a-f0-9]{64}$/)
    expect(persisted.apiKey).not.toContain('tvok-')
    expect(persisted.label).toBe('ci-runner')
    expect(persisted.userId).toBe('admin-1')
    expect(persisted.createdBy).toBe('admin@titvo.dev')
    expect(persisted.status).toBe('active')
  })

  it('returns the raw key in the installer-compatible format, exactly once', async () => {
    const useCase = new CreateApiKeyUseCase(buildApiKeyRepository(async (entity) => entity))

    const result = await useCase.execute('ci-runner', 'admin-1', 'admin@titvo.dev')

    expect(result.apiKey).toMatch(/^tvok-[A-Za-z0-9]{43}$/)
    expect(result.label).toBe('ci-runner')
    expect(result.keyId).toEqual(expect.any(String))
  })

  it('generates a different raw key and hash on every call (triangulation — not hardcoded)', async () => {
    const useCase = new CreateApiKeyUseCase(buildApiKeyRepository(async (entity) => entity))

    const first = await useCase.execute('key-a', 'admin-1', 'admin@titvo.dev')
    const second = await useCase.execute('key-b', 'admin-1', 'admin@titvo.dev')

    expect(first.apiKey).not.toBe(second.apiKey)
    expect(first.keyId).not.toBe(second.keyId)
  })
})
