/**
 * Port for resolving a GitHub branch name to its HEAD commit SHA, backing
 * `POST /api/admin/repos/:id/trigger-scan` (decision #7 — the BFF must
 * resolve `branch` → `github_commit_sha` itself before calling
 * titvo-task-trigger-aws's `/run-scan`, since that endpoint's `args`
 * contract requires an already-resolved commit SHA, not a branch name).
 */
export abstract class GithubApiClient {
  abstract resolveBranchSha (repositoryUrl: string, token: string, branch: string): Promise<string>
  /** Auto-detects the repo's actual default branch (`GET /repos/{owner}/{repo}` → `default_branch`) — backs `GET /api/admin/repos/:id/default-branch`, so the "Run scan" dialog can pre-fill something better than a hardcoded `"main"` guess. */
  abstract fetchDefaultBranch (repositoryUrl: string, token: string): Promise<string>
}
