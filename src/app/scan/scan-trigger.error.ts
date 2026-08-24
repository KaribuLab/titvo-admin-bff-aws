/** Thrown when `POST /api/admin/repos/:id/trigger-scan` targets a `:id` with no matching repo. */
export class RepoNotFoundError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'RepoNotFoundError'
  }
}

/**
 * Thrown when the target repo's `provider` has no matching
 * `ScanTriggerStrategy` (today: anything other than `'github'` or
 * `'bitbucket'`, e.g. `'gitlab'`, `undefined`, or an unrecognized string).
 */
export class UnsupportedProviderError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'UnsupportedProviderError'
  }
}

/**
 * Thrown when the repo record has no usable `url` to trigger a scan
 * against — either missing entirely (best-effort field, see `RepoItem`) or
 * not a recognizable URL for the repo's provider.
 */
export class RepoUrlInvalidError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'RepoUrlInvalidError'
  }
}

/**
 * Thrown when a required config parameter is not set — the shared
 * `bff_scan_trigger_api_key`, or a provider-specific one a
 * `ScanTriggerStrategy` needs (`github_access_token`/`default_github_assignee`
 * for GitHub, `bitbucket_api_token` for Bitbucket). Carries `parameterId` so
 * the handler/SPA can surface exactly which one is missing, instead of a
 * generic failure (decision #4: "the BFF must fail with a clear, actionable
 * error, not a cryptic 500").
 */
export class ConfigMissingError extends Error {
  readonly parameterId: string

  constructor (parameterId: string) {
    super(`Missing required config parameter '${parameterId}'. Set it via Config before triggering a scan.`)
    this.name = 'ConfigMissingError'
    this.parameterId = parameterId
  }
}

/**
 * Thrown when a provider's API cannot resolve the data a
 * `ScanTriggerStrategy` needs — GitHub's branch → commit SHA lookup, or
 * Bitbucket's branch → commit hash / project key lookups (e.g. branch does
 * not exist, token lacks access).
 */
export class BranchResolutionError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'BranchResolutionError'
  }
}

/**
 * Thrown when titvo-task-trigger-aws's `/run-scan` call itself fails.
 * Carries a sanitized message only — the upstream response body is never
 * relayed verbatim (it may echo request args, including tokens).
 */
export class UpstreamScanTriggerError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'UpstreamScanTriggerError'
  }
}
