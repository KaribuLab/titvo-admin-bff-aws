import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { ApiKeyRepository, generateApiKey } from '@titvo/auth'

export interface CreatedApiKey {
  keyId: string
  label: string
  /** Raw, plaintext key — the ONLY place in the whole response surface this ever appears. */
  apiKey: string
}

/**
 * Backs `POST /api/admin/api-keys` (design D4/D8, admin-only — enforced
 * by the handler's role check, not here). Generates the key in the
 * installer's exact `tvok-` format (byte-compatible with
 * `ValidateApiKeyUseCase`'s hashing), persists ONLY the SHA-256 hash via
 * `ApiKeyRepository.create`, and returns the raw key to the caller
 * exactly once — it is never logged, never re-derivable from the stored
 * hash, and never appears in any other response.
 */
@Injectable()
export class CreateApiKeyUseCase {
  constructor (private readonly apiKeyRepository: ApiKeyRepository) {}

  async execute (label: string, actorUserId: string, actorEmail: string): Promise<CreatedApiKey> {
    const { apiKey, hashedApiKey } = generateApiKey()
    const keyId = randomUUID()

    await this.apiKeyRepository.create({
      keyId,
      userId: actorUserId,
      apiKey: hashedApiKey,
      label,
      status: 'active',
      createdAt: new Date().toISOString(),
      createdBy: actorEmail
    })

    return { keyId, label, apiKey }
  }
}
