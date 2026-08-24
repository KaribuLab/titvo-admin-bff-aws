import { Injectable } from '@nestjs/common'
import { AesService } from '@titvo/shared'
import { ConfigRepository } from '@core/config/config.repository'
import { EncryptionUnavailableError } from './config.error'

export interface AddConfigInput {
  parameterId: string
  value: string
  isSecret: boolean
}

/**
 * Backs `POST /api/admin/config`. Encrypts `value` server-side before
 * persisting when `isSecret` (spec: "Server-Side Encryption for Secrets").
 * Encryption is attempted BEFORE any repository write — if the AES key or
 * Secrets Manager is unreachable, `EncryptionUnavailableError` is thrown
 * and `ConfigRepository.putNew` is never called, so plaintext is never
 * persisted under a secret path (spec: "Encryption dependency unavailable").
 * Duplicate keys surface as `ConfigAlreadyExistsError` from the repository
 * (`ConditionExpression attribute_not_exists`, no silent clobber).
 */
@Injectable()
export class AddConfigUseCase {
  constructor (
    private readonly configRepository: ConfigRepository,
    private readonly aesService: AesService
  ) {}

  async execute (input: AddConfigInput, actorEmail: string): Promise<void> {
    const storedValue = input.isSecret ? await this.encryptOrFail(input.value) : input.value

    await this.configRepository.putNew({
      parameterId: input.parameterId,
      value: storedValue,
      isSecret: input.isSecret,
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
