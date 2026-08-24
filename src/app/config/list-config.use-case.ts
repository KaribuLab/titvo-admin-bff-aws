import { Injectable } from '@nestjs/common'
import { AesService } from '@titvo/shared'
import { ConfigRepository } from '@core/config/config.repository'
import { ConfigListItem } from '@core/config/config.entity'
import { resolveIsSecret } from './resolve-is-secret'

/**
 * Backs `GET /api/admin/config`. Renders an empty state (not an error) on
 * an empty table (spec: "Empty table"). NEVER includes the `value` field —
 * secrets are write-only (spec: "Secret Values Are Write-Only").
 */
@Injectable()
export class ListConfigUseCase {
  constructor (
    private readonly configRepository: ConfigRepository,
    private readonly aesService: AesService
  ) {}

  async execute (): Promise<ConfigListItem[]> {
    const items = await this.configRepository.findAll()

    const resolved: ConfigListItem[] = []
    for (const item of items) {
      const isSecret = await resolveIsSecret(item, this.aesService)
      resolved.push({
        parameterId: item.parameterId,
        isSecret,
        updatedAt: item.updatedAt,
        updatedBy: item.updatedBy
      })
    }
    return resolved
  }
}
