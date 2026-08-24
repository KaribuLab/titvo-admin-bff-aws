import { Injectable, Logger } from '@nestjs/common'
import { ApiKeyEntity, ApiKeyNotFoundError, ApiKeyRepository } from '@titvo/auth'
import { countActiveApiKeys, wouldViolateLastActiveKeyInvariant } from './last-active-key-guard'
import { LastActiveKeyError } from './api-key.error'

/**
 * Backs `POST /api/admin/api-keys/:id/revoke` (admin-only, enforced by
 * the handler — not here). Enforces the last-active-key invariant with a
 * two-step, non-atomic guard over `ApiKeyRepository.findAll()` (a `Scan`
 * in production — same accepted race as design D6):
 *
 * 1. Pre-check: reject up front if revoking this key would leave zero
 *    active keys, based on a fresh snapshot. Already-revoked is treated
 *    as an idempotent no-op (no write, no invariant check — spec:
 *    "already-revoked is idempotent 200").
 * 2. Post-write re-count (risk resolution #1/#2 pattern, obs #884): the
 *    pre-check is non-atomic, so a concurrent revoke could race past it.
 *    Immediately after writing, re-count active keys; if the write
 *    actually left zero, roll THIS specific write back via
 *    `ApiKeyRepository.activate` and reject.
 */
@Injectable()
export class RevokeApiKeyUseCase {
  private readonly logger = new Logger(RevokeApiKeyUseCase.name)

  constructor (private readonly apiKeyRepository: ApiKeyRepository) {}

  async execute (keyId: string): Promise<ApiKeyEntity> {
    const keysBeforeWrite = await this.apiKeyRepository.findAll()
    const target = keysBeforeWrite.find((k) => k.keyId === keyId)

    if (target === undefined) {
      throw new ApiKeyNotFoundError(`API key '${keyId}' does not exist`)
    }

    if (target.status === 'revoked') {
      return target
    }

    if (wouldViolateLastActiveKeyInvariant(keysBeforeWrite, keyId)) {
      this.logger.warn('Revoke rejected: would leave zero active API keys')
      throw new LastActiveKeyError('Cannot revoke the last active API key')
    }

    const revoked = await this.apiKeyRepository.revoke(keyId)

    const keysAfterWrite = await this.apiKeyRepository.findAll()

    if (countActiveApiKeys(keysAfterWrite) === 0) {
      this.logger.warn('Revoke raced the last-active-key invariant post-write — rolling back')
      await this.apiKeyRepository.activate(keyId)
      throw new LastActiveKeyError('Cannot revoke the last active API key')
    }

    return revoked
  }
}
