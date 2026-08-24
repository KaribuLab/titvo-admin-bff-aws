import { AesService } from '@titvo/shared'
import { ConfigRepository } from '@core/config/config.repository'
import { ConfigItem } from '@core/config/config.entity'
import { resolveIsSecret } from '../config/resolve-is-secret'
import { ConfigMissingError } from './scan-trigger.error'

/**
 * Reads a config entry and returns its plaintext value, decrypting it when
 * it resolves as a secret (via the SAME `resolveIsSecret` helper
 * `GetConfigUseCase` uses — legacy CLI-written items lacking an explicit
 * `is_secret` attribute are still handled correctly). Unlike
 * `GetConfigUseCase`, this NEVER withholds the value — every caller here is
 * a legitimate internal consumer that needs the actual secret to call an
 * upstream API with it (it is never returned in any HTTP response). A
 * missing/blank entry throws `ConfigMissingError(parameterId)` so the
 * handler can surface exactly which parameter to set (decision #4).
 *
 * Shared by `TriggerScanUseCase` (for `bff_scan_trigger_api_key`) and every
 * per-provider `ScanTriggerStrategy` (for their own provider-specific
 * secrets — `github_access_token`/`default_github_assignee` for GitHub,
 * `bitbucket_api_token` for Bitbucket) so this decrypt-if-secret logic only
 * lives in one place.
 */
export async function readRequiredScanConfigValue (
  configRepository: ConfigRepository,
  aesService: AesService,
  parameterId: string
): Promise<string> {
  const item: ConfigItem | null = await configRepository.findById(parameterId)
  if (item === null || item.value.trim().length === 0) {
    throw new ConfigMissingError(parameterId)
  }

  const isSecret = await resolveIsSecret(item, aesService)
  return isSecret ? await aesService.decrypt(item.value) : item.value
}
