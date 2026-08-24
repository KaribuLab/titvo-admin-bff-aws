import { Injectable } from '@nestjs/common'
import { AesService } from '@titvo/shared'
import { ConfigRepository } from '@core/config/config.repository'
import { RepoItem } from '@core/repo/repo.entity'
import { GithubApiClient } from '@core/scan/github-api.client'
import { RunScanPayload } from '@core/scan/task-trigger.client'
import { ScanTriggerStrategy } from '@core/scan/scan-trigger-strategy'
import { parseGithubRepoUrl } from './parse-github-repo-url'
import { readRequiredScanConfigValue } from './read-required-scan-config-value'
import { RepoUrlInvalidError } from './scan-trigger.error'

const GITHUB_TOKEN_PARAMETER_ID = 'github_access_token'
const DEFAULT_ASSIGNEE_PARAMETER_ID = 'default_github_assignee'

/**
 * Builds the `source: "github"` `/run-scan` payload — confirmed against
 * `trigger/src/app/scm/github.strategy.ts` in titvo-task-trigger-aws. Needs
 * TWO config secrets (`github_access_token` for API/auth, plus
 * `default_github_assignee` since GitHub's contract requires an assignee
 * for issue creation) and one GitHub API call to resolve `branch` → commit
 * SHA.
 */
@Injectable()
export class GithubScanTriggerStrategy implements ScanTriggerStrategy {
  constructor (
    private readonly configRepository: ConfigRepository,
    private readonly aesService: AesService,
    private readonly githubApiClient: GithubApiClient
  ) {}

  supports (provider: string | undefined): boolean {
    return provider === 'github'
  }

  async buildRunScanPayload (repo: RepoItem, branch: string): Promise<RunScanPayload> {
    if (repo.url === undefined || repo.url.trim().length === 0) {
      throw new RepoUrlInvalidError(`Repository '${repo.repositoryId}' has no repository URL on record`)
    }

    const githubToken = await readRequiredScanConfigValue(this.configRepository, this.aesService, GITHUB_TOKEN_PARAMETER_ID)
    const defaultAssignee = await readRequiredScanConfigValue(this.configRepository, this.aesService, DEFAULT_ASSIGNEE_PARAMETER_ID)

    const { owner, repo: repoName } = parseGithubRepoUrl(repo.url)
    const commitSha = await this.githubApiClient.resolveBranchSha(repo.url, githubToken, branch)

    return {
      source: 'github',
      args: {
        repository_url: repo.url,
        github_token: githubToken,
        github_repo_name: `${owner}/${repoName}`,
        github_commit_sha: commitSha,
        github_assignee: defaultAssignee,
        github_branch: branch
      }
    }
  }
}
