import { Injectable } from '@nestjs/common'
import { ApiKeyEntity, ApiKeyRepository } from '@titvo/auth'

/**
 * Metadata-only projection of an `ApiKeyEntity`. Deliberately has NO
 * `apiKey`/`userId` field at all — not just omitted at serialization
 * time — so the hash can never leak through this endpoint even if a
 * future handler change forgets to strip it (design: "Never returns
 * api_key, hashed or otherwise").
 */
export interface ApiKeyListItem {
  keyId: string
  label?: string
  status?: ApiKeyEntity['status']
  createdAt?: string
  createdBy?: string
  lastUsedAt?: string
  revokedAt?: string
}

/**
 * Backs `GET /api/admin/api-keys`. Per design D8, this is read-accessible
 * to `member` AND `admin` — keys are platform-wide/admin-managed, but
 * listing is not gated to admin-only (only create/revoke are writes).
 */
@Injectable()
export class ListApiKeysUseCase {
  constructor (private readonly apiKeyRepository: ApiKeyRepository) {}

  async execute (): Promise<ApiKeyListItem[]> {
    const keys = await this.apiKeyRepository.findAll()

    return keys.map((key): ApiKeyListItem => ({
      keyId: key.keyId,
      label: key.label,
      status: key.status,
      createdAt: key.createdAt,
      createdBy: key.createdBy,
      lastUsedAt: key.lastUsedAt,
      revokedAt: key.revokedAt
    }))
  }
}
