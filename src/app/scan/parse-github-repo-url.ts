import { RepoUrlInvalidError } from './scan-trigger.error'

/**
 * Parses `https://github.com/owner/repo(.git)` or
 * `git@github.com:owner/repo(.git)` into `{owner, repo}`. Mirrors the
 * equivalent parsing logic titvo-rag-indexer used in its GitHub-token-based
 * adapter — that adapter (`github_api_adapter.py`) was removed when
 * rag-indexer migrated to SSH-based Git access (commit `829000e`, "feat:
 * migra obtención de repositorios a Git por SSH"), so this is a fresh
 * TypeScript port of its last pre-removal implementation (recovered via
 * `git show 829000e~1:...`), not a call into still-existing rag-indexer
 * code — see the trigger-scan feature report for details.
 *
 * Shared by `TriggerScanUseCase` (to build `github_repo_name`) and
 * `AxiosGithubApiClient` (to build the GitHub REST API path) so the parsing
 * rules only live in one place.
 */
export function parseGithubRepoUrl (url: string): { owner: string, repo: string } {
  const cleaned = url.trim().replace(/\/+$/, '').replace(/\.git$/, '')

  const sshMatch = /^git@github\.com:([^/]+)\/([^/]+)$/.exec(cleaned)
  if (sshMatch !== null) {
    return { owner: sshMatch[1], repo: sshMatch[2] }
  }

  const httpsMatch = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(cleaned)
  if (httpsMatch !== null) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] }
  }

  throw new RepoUrlInvalidError(`Unsupported or unrecognized GitHub repository URL: ${url}`)
}
