import { AesService } from '@titvo/shared'
import { ConfigItem } from '@core/config/config.entity'
import { EncryptionUnavailableError } from './config.error'

const AES_SECRET_NOT_FOUND_MESSAGE = 'AES secret not found'

/**
 * Resolves the effective `isSecret` flag for a config item. Items written
 * through this feature always carry an explicit `is_secret` attribute and
 * are returned unchanged. Legacy CLI-written items (design: "Items lacking
 * `is_secret` are treated as secrets iff decrypt succeeds") are classified
 * by attempting a decrypt — but a genuine AES-key/Secrets-Manager outage
 * (`AesService`'s own "AES secret not found" error) is NEVER treated as
 * "not a secret": it is re-thrown as `EncryptionUnavailableError` so
 * callers fail loudly instead of silently mislabeling a real secret as
 * plaintext because the key was temporarily unreachable.
 */
export async function resolveIsSecret (item: ConfigItem, aesService: AesService): Promise<boolean> {
  if (item.isSecret !== undefined) {
    return item.isSecret
  }

  try {
    await aesService.decrypt(item.value)
    return true
  } catch (error) {
    if (error instanceof Error && error.message === AES_SECRET_NOT_FOUND_MESSAGE) {
      throw new EncryptionUnavailableError('Unable to resolve secret classification: AES key or Secrets Manager unavailable')
    }
    return false
  }
}
