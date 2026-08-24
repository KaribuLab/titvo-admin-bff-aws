/**
 * Port for Bitbucket Cloud REST API v2.0 calls needed to build a
 * `/run-scan` payload for `source: "bitbucket"`:
 *  - `resolveBranchCommit`: branch name → full commit hash (mirrors
 *    `GithubApiClient.resolveBranchSha`, but Bitbucket's `args` contract
 *    needs the commit passed as `bitbucket_commit`, not a branch).
 *  - `fetchProjectKey`: Bitbucket repos belong to a "project" identified by
 *    a `project_key` that titvo-task-trigger-aws's `BitbucketStrategy`
 *    requires (`bitbucket_project_key`) but that is NOT derivable from a
 *    repo URL — it has to come from the repository resource itself.
 */
export abstract class BitbucketApiClient {
  abstract resolveBranchCommit (workspace: string, repoSlug: string, token: string, branch: string): Promise<string>
  abstract fetchProjectKey (workspace: string, repoSlug: string, token: string): Promise<string>
  /** Auto-detects the repo's actual default branch (`GET /repositories/{workspace}/{repo_slug}` → `mainbranch.name`) — backs `GET /api/admin/repos/:id/default-branch`. */
  abstract fetchDefaultBranch (workspace: string, repoSlug: string, token: string): Promise<string>
}
