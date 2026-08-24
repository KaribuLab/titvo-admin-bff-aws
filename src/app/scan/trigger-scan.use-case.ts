import { Injectable, Logger } from '@nestjs/common'
import { AesService } from '@titvo/shared'
import { ValidateApiKeyUseCase } from '@titvo/auth'
import { RepoRepository } from '@core/repo/repo.repository'
import { ConfigRepository } from '@core/config/config.repository'
import { TaskTriggerClient } from '@core/scan/task-trigger.client'
import { ScanTriggerStrategy } from '@core/scan/scan-trigger-strategy'
import { GithubScanTriggerStrategy } from './github-scan-trigger.strategy'
import { BitbucketScanTriggerStrategy } from './bitbucket-scan-trigger.strategy'
import { readRequiredScanConfigValue } from './read-required-scan-config-value'
import { computeExpectedRepositoryId, deriveRepositorySlug } from './compute-expected-repository-id'
import { RepoNotFoundError, UnsupportedProviderError } from './scan-trigger.error'

export interface TriggerScanInput {
  repositoryId: string
  branch: string
  /** Optional — mirrors titvo-task-trigger-aws's own `scan_mode` (`'commit'` default, or `'full'`). Validated by the handler before reaching here. */
  scanMode?: string
}

export interface TriggerScanOutput {
  scanId: string
  /**
   * Set when the scan almost certainly WON'T show up as this repo's "last
   * scan" — the shared `bff_scan_trigger_api_key` belongs to a different
   * user than whoever's key produced this repo's existing history (see
   * `compute-expected-repository-id.ts`). The scan still runs; this is
   * informational, never blocking.
   */
  repositoryIdWarning?: string
}

const SERVICE_API_KEY_PARAMETER_ID = 'bff_scan_trigger_api_key'

/**
 * Backs `POST /api/admin/repos/:id/trigger-scan` (admin-only, enforced by
 * the handler's role check, not here). Reuses the SAME production
 * `/run-scan` endpoint on titvo-task-trigger-aws that GitHub
 * Actions/Bitbucket Pipelines already call.
 *
 * Provider dispatch is delegated to `ScanTriggerStrategy` implementations
 * (`GithubScanTriggerStrategy`/`BitbucketScanTriggerStrategy` today — same
 * `supports`/`build...` shape titvo-task-trigger-aws's own
 * `ScmStrategyResolver` uses internally) so this use-case stays
 * provider-agnostic: repo lookup, the shared `bff_scan_trigger_api_key`
 * secret, and the actual `/run-scan` call are the only things that live
 * here. A repo whose `provider` has no matching strategy (e.g. `'gitlab'`,
 * `undefined`, or unrecognized) is rejected with `UnsupportedProviderError`
 * before any config is read or any network call is made.
 */
@Injectable()
export class TriggerScanUseCase {
  private readonly logger = new Logger(TriggerScanUseCase.name)
  private readonly strategies: ScanTriggerStrategy[]

  constructor (
    private readonly repoRepository: RepoRepository,
    private readonly configRepository: ConfigRepository,
    private readonly aesService: AesService,
    private readonly taskTriggerClient: TaskTriggerClient,
    private readonly validateApiKeyUseCase: ValidateApiKeyUseCase,
    githubStrategy: GithubScanTriggerStrategy,
    bitbucketStrategy: BitbucketScanTriggerStrategy
  ) {
    this.strategies = [githubStrategy, bitbucketStrategy]
  }

  async execute (input: TriggerScanInput): Promise<TriggerScanOutput> {
    // `RepoRepository` only exposes `findAll()` (design D3 — the
    // `repository` table stays small/unfiltered, no per-id GSI). Filtering
    // in memory here avoids adding a new IAM permission for this feature.
    const repos = await this.repoRepository.findAll()
    const repo = repos.find(item => item.repositoryId === input.repositoryId)
    if (repo === undefined) {
      throw new RepoNotFoundError(`Repository '${input.repositoryId}' not found`)
    }

    const strategy = this.strategies.find(candidate => candidate.supports(repo.provider))
    if (strategy === undefined) {
      throw new UnsupportedProviderError(`Triggering a scan is not supported for this repository's provider ('${repo.provider ?? 'unknown'}')`)
    }

    const payload = await strategy.buildRunScanPayload(repo, input.branch)
    // `scan_mode` is read by titvo-task-trigger-aws from the top-level
    // `args` regardless of source (see `task.service.ts`'s
    // `normalizeScanMode`) — NOT something either `ScanTriggerStrategy`
    // builds itself, since it is provider-agnostic.
    if (input.scanMode !== undefined) {
      payload.args.scan_mode = input.scanMode
    }
    const serviceApiKey = await readRequiredScanConfigValue(this.configRepository, this.aesService, SERVICE_API_KEY_PARAMETER_ID)

    const repositoryIdWarning = await this.checkRepositoryIdWarning(repo.repositoryId, payload.source, payload.args, serviceApiKey)

    const result = await this.taskTriggerClient.runScan(serviceApiKey, payload)

    return { scanId: result.scanId, repositoryIdWarning }
  }

  /**
   * Best-effort, NEVER blocking: reproduces titvo-task-trigger-aws's own
   * `repositoryId` formula for what THIS scan will be filed under, and
   * compares it to the repo's existing `repositoryId`. Any failure here
   * (the service key doesn't validate, the slug can't be derived, etc.)
   * is swallowed and treated as "cannot verify" — the authoritative
   * validation of the service key itself still happens in the real
   * `/run-scan` call right after this. This function only ever adds an
   * informational warning; it never throws.
   */
  private async checkRepositoryIdWarning (
    existingRepositoryId: string,
    source: string,
    args: Record<string, string>,
    serviceApiKey: string
  ): Promise<string | undefined> {
    try {
      const repositorySlug = deriveRepositorySlug(source, args)
      if (repositorySlug === undefined) {
        return undefined
      }

      const apiKeyEntity = await this.validateApiKeyUseCase.execute(serviceApiKey)
      const expectedRepositoryId = computeExpectedRepositoryId(apiKeyEntity.userId, repositorySlug)

      if (expectedRepositoryId === existingRepositoryId) {
        return undefined
      }

      return "This scan won't be linked to this repository's existing history — the configured 'bff_scan_trigger_api_key' service key belongs to a different user than whichever key was originally used for this repository's scans. The scan will still run; it just may not appear as this repo's most recent scan."
    } catch (error) {
      this.logger.warn(`Could not verify repositoryId alignment before triggering: ${error instanceof Error ? error.message : 'unknown error'}`)
      return undefined
    }
  }
}
