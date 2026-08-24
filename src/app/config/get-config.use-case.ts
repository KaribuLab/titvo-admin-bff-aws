import { Injectable } from '@nestjs/common'
import { AesService } from '@titvo/shared'
import { ConfigRepository } from '@core/config/config.repository'
import { ConfigDetail } from '@core/config/config.entity'
import { resolveIsSecret } from './resolve-is-secret'

/**
 * Backs `GET /api/admin/config/:id`. `value` is present only when the
 * resolved `isSecret` is `false` — a saved secret's plaintext or
 * ciphertext is never returned (spec: "Secret Values Are Write-Only").
 */
@Injectable()
export class GetConfigUseCase {
  constructor (
    private readonly configRepository: ConfigRepository,
    private readonly aesService: AesService
  ) {}

  async execute (parameterId: string): Promise<ConfigDetail | null> {
    const item = await this.configRepository.findById(parameterId)
    if (item === null) {
      return null
    }

    const isSecret = await resolveIsSecret(item, this.aesService)

    return {
      parameterId: item.parameterId,
      isSecret,
      value: isSecret ? undefined : item.value,
      updatedAt: item.updatedAt,
      updatedBy: item.updatedBy
    }
  }
}
