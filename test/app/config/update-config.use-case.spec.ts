import { describe, expect, it, vi } from 'vitest'
import { AesService } from '@titvo/shared'
import { ConfigRepository, ConfigUpdatePatch } from '@core/config/config.repository'
import { ConfigItem } from '@core/config/config.entity'
import { UpdateConfigUseCase } from '@app/config/update-config.use-case'
import { ConfigNotFoundError, ConfigTypeMismatchError, EncryptionUnavailableError } from '@app/config/config.error'

function buildRepository (
  findById: (id: string) => Promise<ConfigItem | null>,
  update: (id: string, patch: ConfigUpdatePatch) => Promise<void> = vi.fn().mockResolvedValue(undefined)
): ConfigRepository {
  return { findAll: vi.fn(), findById, putNew: vi.fn(), update } as unknown as ConfigRepository
}

describe('UpdateConfigUseCase', () => {
  it('throws ConfigNotFoundError when the key does not exist', async () => {
    const repository = buildRepository(async () => null)
    const useCase = new UpdateConfigUseCase(repository, { encrypt: vi.fn(), decrypt: vi.fn() } as unknown as AesService)

    await expect(useCase.execute('missing', { value: 'x' }, 'admin@titvo.dev')).rejects.toThrow(ConfigNotFoundError)
  })

  it('replaces the value of an existing plaintext parameter (last-write-wins)', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    const repository = buildRepository(async () => ({ parameterId: 'p1', value: 'old', isSecret: false, updatedAt: 'a', updatedBy: 'b' }), update)
    const encrypt = vi.fn()
    const useCase = new UpdateConfigUseCase(repository, { encrypt, decrypt: vi.fn() } as unknown as AesService)

    await useCase.execute('p1', { value: 'new-value' }, 'member-turned-admin@titvo.dev')

    expect(encrypt).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith('p1', expect.objectContaining({ value: 'new-value', isSecret: false, updatedBy: 'member-turned-admin@titvo.dev' }))
  })

  it('encrypts a new value for an existing secret', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    const repository = buildRepository(async () => ({ parameterId: 'p2', value: 'old-cipher', isSecret: true, updatedAt: 'a', updatedBy: 'b' }), update)
    const encrypt = vi.fn().mockResolvedValue('NEW_CIPHER')
    const useCase = new UpdateConfigUseCase(repository, { encrypt, decrypt: vi.fn() } as unknown as AesService)

    await useCase.execute('p2', { value: 'new-secret-value' }, 'admin@titvo.dev')

    expect(encrypt).toHaveBeenCalledWith('new-secret-value')
    expect(update).toHaveBeenCalledWith('p2', expect.objectContaining({ value: 'NEW_CIPHER', isSecret: true }))
  })

  it('leaves the stored value untouched when value is omitted from the request', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    const repository = buildRepository(async () => ({ parameterId: 'p3', value: 'unchanged', isSecret: false, updatedAt: 'a', updatedBy: 'b' }), update)
    const useCase = new UpdateConfigUseCase(repository, { encrypt: vi.fn(), decrypt: vi.fn() } as unknown as AesService)

    await useCase.execute('p3', {}, 'admin@titvo.dev')

    expect(update).toHaveBeenCalledWith('p3', expect.objectContaining({ value: undefined, isSecret: false }))
  })

  it('rejects with ConfigTypeMismatchError when a request flips is_secret on an existing key', async () => {
    const update = vi.fn()
    const repository = buildRepository(async () => ({ parameterId: 'p4', value: 'plain', isSecret: false, updatedAt: 'a', updatedBy: 'b' }), update)
    const useCase = new UpdateConfigUseCase(repository, { encrypt: vi.fn(), decrypt: vi.fn() } as unknown as AesService)

    await expect(useCase.execute('p4', { isSecret: true, value: 'x' }, 'admin@titvo.dev')).rejects.toThrow(ConfigTypeMismatchError)
    expect(update).not.toHaveBeenCalled()
  })

  it('allows an explicit is_secret resubmission that matches the existing type (no-op flag, not an error)', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    const repository = buildRepository(async () => ({ parameterId: 'p5', value: 'plain', isSecret: false, updatedAt: 'a', updatedBy: 'b' }), update)
    const useCase = new UpdateConfigUseCase(repository, { encrypt: vi.fn(), decrypt: vi.fn() } as unknown as AesService)

    await expect(useCase.execute('p5', { isSecret: false, value: 'new' }, 'admin@titvo.dev')).resolves.toBeUndefined()
  })

  it('fails loudly with EncryptionUnavailableError and never calls update when encryption fails', async () => {
    const update = vi.fn()
    const repository = buildRepository(async () => ({ parameterId: 'p6', value: 'old-cipher', isSecret: true, updatedAt: 'a', updatedBy: 'b' }), update)
    const encrypt = vi.fn().mockRejectedValue(new Error('AES secret not found'))
    const useCase = new UpdateConfigUseCase(repository, { encrypt, decrypt: vi.fn() } as unknown as AesService)

    await expect(useCase.execute('p6', { value: 'new-secret' }, 'admin@titvo.dev')).rejects.toThrow(EncryptionUnavailableError)
    expect(update).not.toHaveBeenCalled()
  })
})
