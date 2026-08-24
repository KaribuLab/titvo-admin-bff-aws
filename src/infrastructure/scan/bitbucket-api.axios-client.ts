import axios from 'axios'
import { BitbucketApiClient } from '@core/scan/bitbucket-api.client'
import { BranchResolutionError } from '@app/scan/scan-trigger.error'

const BITBUCKET_API_BASE = 'https://api.bitbucket.org/2.0'

interface GetBranchResponse {
  target?: { hash?: string }
}

interface GetRepoResponse {
  project?: { key?: string }
  mainbranch?: { name?: string }
}

function authHeader (token: string): { Authorization: string } {
  // NOT Bearer — mirrors the exact header titvo-git-commit-files-aws's live
  // `BitbucketClientService.getAuthHeaders()` already uses successfully
  // against this same API with this same `bitbucket_api_token` secret.
  return { Authorization: `Basic ${token}` }
}

/**
 * Calls Bitbucket Cloud's REST API v2.0 to resolve the two pieces of data
 * `BitbucketScanTriggerStrategy` needs that GitHub's flow doesn't: a branch
 * → commit hash lookup (same endpoint shape as GitHub's, different host/
 * response field) and a separate project-key lookup (Bitbucket has no
 * equivalent GitHub concept — a repo's `project.key` only comes back from
 * the repository resource itself).
 */
export class AxiosBitbucketApiClient extends BitbucketApiClient {
  async resolveBranchCommit (workspace: string, repoSlug: string, token: string, branch: string): Promise<string> {
    let hash: unknown
    try {
      const response = await axios.get<GetBranchResponse>(
        `${BITBUCKET_API_BASE}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/refs/branches/${encodeURIComponent(branch)}`,
        { headers: authHeader(token) }
      )
      hash = response.data?.target?.hash
    } catch {
      throw new BranchResolutionError(`Could not resolve branch '${branch}' for ${workspace}/${repoSlug}: Bitbucket API request failed`)
    }

    if (typeof hash !== 'string' || hash.length === 0) {
      throw new BranchResolutionError(`Could not resolve branch '${branch}' for ${workspace}/${repoSlug}`)
    }

    return hash
  }

  async fetchProjectKey (workspace: string, repoSlug: string, token: string): Promise<string> {
    let key: unknown
    try {
      const response = await axios.get<GetRepoResponse>(
        `${BITBUCKET_API_BASE}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}`,
        { headers: authHeader(token) }
      )
      key = response.data?.project?.key
    } catch {
      throw new BranchResolutionError(`Could not resolve the Bitbucket project key for ${workspace}/${repoSlug}: Bitbucket API request failed`)
    }

    if (typeof key !== 'string' || key.length === 0) {
      throw new BranchResolutionError(`Could not resolve the Bitbucket project key for ${workspace}/${repoSlug}`)
    }

    return key
  }

  async fetchDefaultBranch (workspace: string, repoSlug: string, token: string): Promise<string> {
    let name: unknown
    try {
      const response = await axios.get<GetRepoResponse>(
        `${BITBUCKET_API_BASE}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}`,
        { headers: authHeader(token) }
      )
      name = response.data?.mainbranch?.name
    } catch {
      throw new BranchResolutionError(`Could not determine the default branch for ${workspace}/${repoSlug}: Bitbucket API request failed`)
    }

    if (typeof name !== 'string' || name.length === 0) {
      throw new BranchResolutionError(`Could not determine the default branch for ${workspace}/${repoSlug}`)
    }

    return name
  }
}
