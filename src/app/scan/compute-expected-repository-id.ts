import { createHash } from 'crypto'

/**
 * Reproduces titvo-task-trigger-aws's OWN `repositoryId` formula exactly
 * (`trigger/src/app/task/task.service.ts`: `` `${apiKey.userId}:${repositorySlugHash}` ``,
 * `repositorySlugHash = createHash('md5').update(repositorySlug).digest('hex')`).
 *
 * Why this exists: task-trigger-aws keys a scan's `repositoryId` off BOTH
 * the repo slug AND the userId of whichever API key authenticated the
 * `/run-scan` call — NOT just the repo. That means a scan triggered via
 * this admin console (using the shared `bff_scan_trigger_api_key`) only
 * lines up with an existing repo's scan history if that service key
 * happens to belong to the SAME user whose key CI has been using for that
 * repo all along. `TriggerScanUseCase` calls this to detect a mismatch
 * BEFORE it becomes a silent "why did my triggered scan disappear"
 * confusion later — see `scan-trigger.error.ts`'s discussion and the
 * feature report for the full context (no fix is possible without also
 * changing titvo-task-trigger-aws itself, which is out of scope here; this
 * turns the failure mode from silent into loudly-warned).
 */
export function computeExpectedRepositoryId (ownerUserId: string, repositorySlug: string): string {
  const repositorySlugHash = createHash('md5').update(repositorySlug).digest('hex')
  return `${ownerUserId}:${repositorySlugHash}`
}

/**
 * Derives the `repository_slug` value titvo-task-trigger-aws's own SCM
 * strategies compute internally, from the `RunScanPayload` a
 * `ScanTriggerStrategy` already built — GitHub's is `github_repo_name`
 * as-is; Bitbucket's is `` `${bitbucket_workspace}/${bitbucket_repo_slug}` ``
 * (see `trigger/src/app/scm/github.strategy.ts` and
 * `.../bitbucket.strategy.ts`). Returns `undefined` for a source this
 * mismatch check doesn't know how to reproduce yet — callers must treat
 * that as "cannot verify" (skip the warning), never as "confirmed no
 * mismatch".
 */
export function deriveRepositorySlug (source: string, args: Record<string, string>): string | undefined {
  if (source === 'github') {
    return args.github_repo_name
  }
  if (source === 'bitbucket') {
    if (args.bitbucket_workspace === undefined || args.bitbucket_repo_slug === undefined) {
      return undefined
    }
    return `${args.bitbucket_workspace}/${args.bitbucket_repo_slug}`
  }
  return undefined
}
