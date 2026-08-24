import axios from 'axios'
import { GithubApiClient } from '@core/scan/github-api.client'
import { parseGithubRepoUrl } from '@app/scan/parse-github-repo-url'
import { BranchResolutionError } from '@app/scan/scan-trigger.error'

const GITHUB_API_BASE = 'https://api.github.com'

interface GetRefResponse {
  object?: { sha?: string }
}

interface GetRepoResponse {
  default_branch?: string
}

/**
 * Calls `GET /repos/{owner}/{repo}/git/ref/heads/{branch}` on GitHub's REST
 * API to resolve a branch name to its HEAD commit SHA. This is a fresh
 * TypeScript port of titvo-rag-indexer's last GitHub-token-based
 * `resolve_branch_sha` implementation (see `parseGithubRepoUrl`'s doc
 * comment for why that Python file no longer exists in rag-indexer today)
 * — same base URL, same header set (`Bearer` token, `application/vnd.github+json`,
 * pinned `X-GitHub-Api-Version`), same endpoint and response field.
 */
export class AxiosGithubApiClient extends GithubApiClient {
  async resolveBranchSha (repositoryUrl: string, token: string, branch: string): Promise<string> {
    const { owner, repo } = parseGithubRepoUrl(repositoryUrl)

    let sha: unknown
    try {
      const response = await axios.get<GetRefResponse>(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
          }
        }
      )
      sha = response.data?.object?.sha
    } catch {
      throw new BranchResolutionError(`Could not resolve branch '${branch}' for ${owner}/${repo}: GitHub API request failed`)
    }

    if (typeof sha !== 'string' || sha.length === 0) {
      throw new BranchResolutionError(`Could not resolve branch '${branch}' for ${owner}/${repo}`)
    }

    return sha
  }

  async fetchDefaultBranch (repositoryUrl: string, token: string): Promise<string> {
    const { owner, repo } = parseGithubRepoUrl(repositoryUrl)

    let defaultBranch: unknown
    try {
      const response = await axios.get<GetRepoResponse>(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
          }
        }
      )
      defaultBranch = response.data?.default_branch
    } catch {
      throw new BranchResolutionError(`Could not determine the default branch for ${owner}/${repo}: GitHub API request failed`)
    }

    if (typeof defaultBranch !== 'string' || defaultBranch.length === 0) {
      throw new BranchResolutionError(`Could not determine the default branch for ${owner}/${repo}`)
    }

    return defaultBranch
  }
}
