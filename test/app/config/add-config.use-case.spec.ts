import { describe, expect, it, vi } from 'vitest'
import { AesService } from '@titvo/shared'
import { ConfigRepository, NewConfigItem } from '@core/config/config.repository'
import { AddConfigUseCase } from '@app/config/add-config.use-case'
import { ConfigAlreadyExistsError, EncryptionUnavailableError } from '@app/config/config.error'

function buildRepository (putNew: (item: NewConfigItem) => Promise<void>): ConfigRepository {
  return { findAll: vi.fn(), findById: vi.fn(), putNew, update: vi.fn() } as unknown as ConfigRepository
}

describe('AddConfigUseCase', () => {
  it('stores a plaintext parameter unmodified', async () => {
    const putNew = vi.fn().mockResolvedValue(undefined)
    const repository = buildRepository(putNew)
    const encrypt = vi.fn()
    const useCase = new AddConfigUseCase(repository, { encrypt, decrypt: vi.fn() } as unknown as AesService)

    await useCase.execute({ parameterId: 'p1', value: 'plain-value', isSecret: false }, 'admin@titvo.dev')

    expect(encrypt).not.toHaveBeenCalled()
    expect(putNew).toHaveBeenCalledWith(expect.objectContaining({
      parameterId: 'p1',
      value: 'plain-value',
      isSecret: false,
      updatedBy: 'admin@titvo.dev'
    }))
  })

  it('encrypts a secret value before storing it (server-side encrypt-on-save)', async () => {
    const putNew = vi.fn().mockResolvedValue(undefined)
    const repository = buildRepository(putNew)
    const encrypt = vi.fn().mockResolvedValue('ENCRYPTED_BASE64')
    const useCase = new AddConfigUseCase(repository, { encrypt, decrypt: vi.fn() } as unknown as AesService)

    await useCase.execute({ parameterId: 'p2', value: 'super-secret', isSecret: true }, 'admin@titvo.dev')

    expect(encrypt).toHaveBeenCalledWith('super-secret')
    expect(putNew).toHaveBeenCalledWith(expect.objectContaining({ parameterId: 'p2', value: 'ENCRYPTED_BASE64', isSecret: true }))
  })

  it('rejects a duplicate key with ConfigAlreadyExistsError, matching the repository conflict', async () => {
    const putNew = vi.fn().mockRejectedValue(new ConfigAlreadyExistsError("Config entry 'p1' already exists"))
    const repository = buildRepository(putNew)
    const useCase = new AddConfigUseCase(repository, { encrypt: vi.fn(), decrypt: vi.fn() } as unknown as AesService)

    await expect(useCase.execute({ parameterId: 'p1', value: 'x', isSecret: false }, 'admin@titvo.dev'))
      .rejects.toThrow(ConfigAlreadyExistsError)
  })

  it('fails loudly with EncryptionUnavailableError and NEVER calls putNew when encryption fails (no plaintext persisted under a secret path)', async () => {
    const putNew = vi.fn()
    const repository = buildRepository(putNew)
    const encrypt = vi.fn().mockRejectedValue(new Error('AES secret not found'))
    const useCase = new AddConfigUseCase(repository, { encrypt, decrypt: vi.fn() } as unknown as AesService)

    await expect(useCase.execute({ parameterId: 'p3', value: 'secret-value', isSecret: true }, 'admin@titvo.dev'))
      .rejects.toThrow(EncryptionUnavailableError)
    expect(putNew).not.toHaveBeenCalled()
  })
})
