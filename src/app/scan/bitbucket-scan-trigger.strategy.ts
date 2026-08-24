import { Injectable } from '@nestjs/common'
import { AesService } from '@titvo/shared'
import { ConfigRepository } from '@core/config/config.repository'
import { RepoItem } from '@core/repo/repo.entity'
import { BitbucketApiClient } from '@core/scan/bitbucket-api.client'
import { RunScanPayload } from '@core/scan/task-trigger.client'
import { ScanTriggerStrategy } from '@core/scan/scan-trigger-strategy'
import { parseBitbucketRepoUrl } from './parse-bitbucket-repo-url'
import { readRequiredScanConfigValue } from './read-required-scan-config-value'
import { RepoUrlInvalidError } from './scan-trigger.error'

const BITBUCKET_TOKEN_PARAMETER_ID = 'bitbucket_api_token'

/**
 * Builds the `source: "bitbucket"` `/run-scan` payload — confirmed against
 * `trigger/src/app/scm/bitbucket.strategy.ts` in titvo-task-trigger-aws.
 * Deliberately different from GitHub's strategy in two ways the upstream
 * contract itself dictates:
 *  - only ONE config secret is needed (`bitbucket_api_token`) —
 *    `BitbucketStrategy.handle()` does not require/forward a per-assignee
 *    field at all, unlike GitHub's, so there is no `default_bitbucket_assignee`
 *    parameter to introduce.
 *  - `bitbucket_project_key` is required by the contract but is NOT
 *    derivable from the repo URL (Bitbucket "projects" are a workspace-level
 *    grouping, not a URL segment) — resolved via one extra Bitbucket API
 *    call (`GET /repositories/{workspace}/{repo_slug}` → `project.key`)
 *    rather than a new manual config parameter, so this stays a one-step
 *    "just works" flow like GitHub's.
 */
@Injectable()
export class BitbucketScanTriggerStrategy implements ScanTriggerStrategy {
  constructor (
    private readonly configRepository: ConfigRepository,
    private readonly aesService: AesService,
    private readonly bitbucketApiClient: BitbucketApiClient
  ) {}

  supports (provider: string | undefined): boolean {
    return provider === 'bitbucket'
  }

  async buildRunScanPayload (repo: RepoItem, branch: string): Promise<RunScanPayload> {
    if (repo.url === undefined || repo.url.trim().length === 0) {
      throw new RepoUrlInvalidError(`Repository '${repo.repositoryId}' has no repository URL on record`)
    }

    const token = await readRequiredScanConfigValue(this.configRepository, this.aesService, BITBUCKET_TOKEN_PARAMETER_ID)

    const { workspace, repoSlug } = parseBitbucketRepoUrl(repo.url)
    const commit = await this.bitbucketApiClient.resolveBranchCommit(workspace, repoSlug, token, branch)
    const projectKey = await this.bitbucketApiClient.fetchProjectKey(workspace, repoSlug, token)

    return {
      source: 'bitbucket',
      args: {
        repository_url: repo.url,
        bitbucket_workspace: workspace,
        bitbucket_repo_slug: repoSlug,
        bitbucket_project_key: projectKey,
        bitbucket_commit: commit,
        bitbucket_branch: branch
      }
    }
  }
}
