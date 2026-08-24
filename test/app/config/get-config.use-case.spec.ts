import { describe, expect, it, vi } from 'vitest'
import { AesService } from '@titvo/shared'
import { ConfigRepository } from '@core/config/config.repository'
import { ConfigItem } from '@core/config/config.entity'
import { GetConfigUseCase } from '@app/config/get-config.use-case'

function buildRepository (findById: (id: string) => Promise<ConfigItem | null>): ConfigRepository {
  return { findAll: vi.fn(), findById, putNew: vi.fn(), update: vi.fn() } as unknown as ConfigRepository
}

function buildAesService (decrypt: (value: string) => Promise<string> = vi.fn()): AesService {
  return { decrypt, encrypt: vi.fn() } as unknown as AesService
}

describe('GetConfigUseCase', () => {
  it('returns null when the entry does not exist', async () => {
    const repository = buildRepository(async () => null)
    const useCase = new GetConfigUseCase(repository, buildAesService())

    expect(await useCase.execute('missing')).toBeNull()
  })

  it('returns the plaintext value for a non-secret parameter', async () => {
    const repository = buildRepository(async () => ({ parameterId: 'p1', value: 'hello', isSecret: false, updatedAt: 'a', updatedBy: 'b' }))
    const useCase = new GetConfigUseCase(repository, buildAesService())

    const result = await useCase.execute('p1')

    expect(result).toEqual({ parameterId: 'p1', isSecret: false, value: 'hello', updatedAt: 'a', updatedBy: 'b' })
  })

  it('omits the value field for a secret entry — never returns ciphertext or plaintext', async () => {
    const repository = buildRepository(async () => ({ parameterId: 'p2', value: 'ciphertext', isSecret: true, updatedAt: 'a', updatedBy: 'b' }))
    const useCase = new GetConfigUseCase(repository, buildAesService())

    const result = await useCase.execute('p2')

    expect(result).toEqual({ parameterId: 'p2', isSecret: true, value: undefined, updatedAt: 'a', updatedBy: 'b' })
    expect(JSON.stringify(result)).not.toContain('ciphertext')
  })
})
