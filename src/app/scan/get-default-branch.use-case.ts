import { Injectable } from '@nestjs/common'
import { AesService } from '@titvo/shared'
import { RepoRepository } from '@core/repo/repo.repository'
import { ConfigRepository } from '@core/config/config.repository'
import { GithubApiClient } from '@core/scan/github-api.client'
import { BitbucketApiClient } from '@core/scan/bitbucket-api.client'
import { parseGithubRepoUrl } from './parse-github-repo-url'
import { parseBitbucketRepoUrl } from './parse-bitbucket-repo-url'
import { readRequiredScanConfigValue } from './read-required-scan-config-value'
import { RepoNotFoundError, RepoUrlInvalidError, UnsupportedProviderError } from './scan-trigger.error'

export interface GetDefaultBranchOutput {
  branch: string
}

/**
 * Backs `GET /api/admin/repos/:id/default-branch` — auto-detects the
 * repo's actual default branch (GitHub's `default_branch`, Bitbucket's
 * `mainbranch.name`) so the "Run scan" dialog can pre-fill something better
 * than the hardcoded `"main"` guess it shipped with. Deliberately a
 * SEPARATE, smaller use-case from `TriggerScanUseCase` rather than another
 * `ScanTriggerStrategy` method — the two operations don't share meaningful
 * logic (this needs only ONE provider secret + ONE API call, no
 * `bff_scan_trigger_api_key`, no `/run-scan` call at all).
 */
@Injectable()
export class GetDefaultBranchUseCase {
  constructor (
    private readonly repoRepository: RepoRepository,
    private readonly configRepository: ConfigRepository,
    private readonly aesService: AesService,
    private readonly githubApiClient: GithubApiClient,
    private readonly bitbucketApiClient: BitbucketApiClient
  ) {}

  async execute (repositoryId: string): Promise<GetDefaultBranchOutput> {
    const repos = await this.repoRepository.findAll()
    const repo = repos.find(item => item.repositoryId === repositoryId)
    if (repo === undefined) {
      throw new RepoNotFoundError(`Repository '${repositoryId}' not found`)
    }

    if (repo.url === undefined || repo.url.trim().length === 0) {
      throw new RepoUrlInvalidError(`Repository '${repositoryId}' has no repository URL on record`)
    }

    if (repo.provider === 'github') {
      const token = await readRequiredScanConfigValue(this.configRepository, this.aesService, 'github_access_token')
      parseGithubRepoUrl(repo.url) // validates the URL shape before the API call
      const branch = await this.githubApiClient.fetchDefaultBranch(repo.url, token)
      return { branch }
    }

    if (repo.provider === 'bitbucket') {
      const token = await readRequiredScanConfigValue(this.configRepository, this.aesService, 'bitbucket_api_token')
      const { workspace, repoSlug } = parseBitbucketRepoUrl(repo.url)
      const branch = await this.bitbucketApiClient.fetchDefaultBranch(workspace, repoSlug, token)
      return { branch }
    }

    throw new UnsupportedProviderError(`Detecting the default branch is not supported for this repository's provider ('${repo.provider ?? 'unknown'}')`)
  }
}
