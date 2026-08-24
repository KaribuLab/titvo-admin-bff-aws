import { Injectable } from '@nestjs/common'
import { AesService } from '@titvo/shared'
import { ConfigRepository } from '@core/config/config.repository'
import { ConfigNotFoundError, ConfigTypeMismatchError, EncryptionUnavailableError } from './config.error'
import { resolveIsSecret } from './resolve-is-secret'

export interface UpdateConfigInput {
  value?: string
  isSecret?: boolean
}

/**
 * Backs `PUT /api/admin/config/:id`. Last-write-wins, no version field
 * (design D4). Omitted `value` leaves the stored value untouched. An
 * explicit `is_secret` that disagrees with the existing entry's resolved
 * type is rejected with `ConfigTypeMismatchError` (409) — the
 * runtime-decryption-break guard; a resubmission that MATCHES is a no-op,
 * not an error. Encryption failures never reach the repository (same
 * fail-loudly contract as add).
 */
@Injectable()
export class UpdateConfigUseCase {
  constructor (
    private readonly configRepository: ConfigRepository,
    private readonly aesService: AesService
  ) {}

  async execute (parameterId: string, patch: UpdateConfigInput, actorEmail: string): Promise<void> {
    const existing = await this.configRepository.findById(parameterId)
    if (existing === null) {
      throw new ConfigNotFoundError(`Config entry '${parameterId}' does not exist`)
    }

    const existingIsSecret = await resolveIsSecret(existing, this.aesService)

    if (patch.isSecret !== undefined && patch.isSecret !== existingIsSecret) {
      throw new ConfigTypeMismatchError(`Cannot change is_secret for existing key '${parameterId}'`)
    }

    const storedValue = patch.value === undefined
      ? undefined
      : (existingIsSecret ? await this.encryptOrFail(patch.value) : patch.value)

    await this.configRepository.update(parameterId, {
      value: storedValue,
      isSecret: existingIsSecret,
      updatedAt: new Date().toISOString(),
      updatedBy: actorEmail
    })
  }

  private async encryptOrFail (value: string): Promise<string> {
    try {
      return await this.aesService.encrypt(value)
    } catch {
      throw new EncryptionUnavailableError('Unable to encrypt secret value: AES key or Secrets Manager unavailable')
    }
  }
}
