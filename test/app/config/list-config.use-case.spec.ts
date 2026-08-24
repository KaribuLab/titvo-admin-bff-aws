import { describe, expect, it, vi } from 'vitest'
import { AesService } from '@titvo/shared'
import { ConfigRepository } from '@core/config/config.repository'
import { ConfigItem } from '@core/config/config.entity'
import { ListConfigUseCase } from '@app/config/list-config.use-case'
import { EncryptionUnavailableError } from '@app/config/config.error'

function buildRepository (findAll: () => Promise<ConfigItem[]>): ConfigRepository {
  return { findAll, findById: vi.fn(), putNew: vi.fn(), update: vi.fn() } as unknown as ConfigRepository
}

function buildAesService (decrypt: (value: string) => Promise<string>): AesService {
  return { decrypt, encrypt: vi.fn() } as unknown as AesService
}

describe('ListConfigUseCase', () => {
  it('returns an empty items array (not an error) when the table has no entries', async () => {
    const repository = buildRepository(async () => [])
    const useCase = new ListConfigUseCase(repository, buildAesService(vi.fn()))

    const result = await useCase.execute()

    expect(result).toEqual([])
  })

  it('lists entries with resolved isSecret and NEVER includes the value field', async () => {
    const repository = buildRepository(async () => [
      { parameterId: 'p1', value: 'plaintext-value', isSecret: false, updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'admin@titvo.dev' },
      { parameterId: 'p2', value: 'ciphertext-value', isSecret: true, updatedAt: '2026-01-02T00:00:00.000Z', updatedBy: 'admin@titvo.dev' }
    ])
    const useCase = new ListConfigUseCase(repository, buildAesService(vi.fn()))

    const result = await useCase.execute()

    expect(result).toEqual([
      { parameterId: 'p1', isSecret: false, updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'admin@titvo.dev' },
      { parameterId: 'p2', isSecret: true, updatedAt: '2026-01-02T00:00:00.000Z', updatedBy: 'admin@titvo.dev' }
    ])
    for (const item of result) {
      expect(item).not.toHaveProperty('value')
    }
  })

  it('infers isSecret for CLI-written entries lacking the attribute (decrypt succeeds → secret)', async () => {
    const repository = buildRepository(async () => [
      { parameterId: 'legacy', value: 'ciphertext', isSecret: undefined }
    ])
    const decrypt = vi.fn().mockResolvedValue('decoded')
    const useCase = new ListConfigUseCase(repository, buildAesService(decrypt))

    const result = await useCase.execute()

    expect(result).toEqual([{ parameterId: 'legacy', isSecret: true, updatedAt: undefined, updatedBy: undefined }])
    expect(decrypt).toHaveBeenCalledWith('ciphertext')
  })

  it('propagates EncryptionUnavailableError instead of silently mislabeling entries', async () => {
    const repository = buildRepository(async () => [
      { parameterId: 'legacy', value: 'x', isSecret: undefined }
    ])
    const decrypt = vi.fn().mockRejectedValue(new Error('AES secret not found'))
    const useCase = new ListConfigUseCase(repository, buildAesService(decrypt))

    await expect(useCase.execute()).rejects.toThrow(EncryptionUnavailableError)
  })
})
