import { describe, expect, it, vi } from 'vitest'
import { AesService } from '@titvo/shared'
import { resolveIsSecret } from '@app/config/resolve-is-secret'
import { EncryptionUnavailableError } from '@app/config/config.error'

function buildAesService (decrypt: (value: string) => Promise<string>): AesService {
  return { decrypt } as unknown as AesService
}

describe('resolveIsSecret', () => {
  it('returns the explicit isSecret flag without calling AesService when it is already known', async () => {
    const decrypt = vi.fn()
    const aesService = buildAesService(decrypt)

    const result = await resolveIsSecret({ parameterId: 'p1', value: 'plain', isSecret: false }, aesService)

    expect(result).toBe(false)
    expect(decrypt).not.toHaveBeenCalled()
  })

  it('returns true for a legacy CLI-written item when decrypt succeeds', async () => {
    const decrypt = vi.fn().mockResolvedValue('the-plaintext-secret')
    const aesService = buildAesService(decrypt)

    const result = await resolveIsSecret({ parameterId: 'p2', value: 'ciphertext', isSecret: undefined }, aesService)

    expect(result).toBe(true)
    expect(decrypt).toHaveBeenCalledWith('ciphertext')
  })

  it('returns false for a legacy CLI-written item when decrypt fails with a format error (not a real secret)', async () => {
    const decrypt = vi.fn().mockRejectedValue(new Error('bad decrypt'))
    const aesService = buildAesService(decrypt)

    const result = await resolveIsSecret({ parameterId: 'p3', value: 'plain-parameter', isSecret: undefined }, aesService)

    expect(result).toBe(false)
  })

  it('throws EncryptionUnavailableError (never mislabels) when the AES secret itself cannot be reached', async () => {
    const decrypt = vi.fn().mockRejectedValue(new Error('AES secret not found'))
    const aesService = buildAesService(decrypt)

    await expect(resolveIsSecret({ parameterId: 'p4', value: 'x', isSecret: undefined }, aesService))
      .rejects.toThrow(EncryptionUnavailableError)
  })
})
