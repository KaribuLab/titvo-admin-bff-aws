import { RepoItem } from '@core/repo/repo.entity'
import { RunScanPayload } from '@core/scan/task-trigger.client'

/**
 * Per-provider strategy that turns a repo record + branch into the exact
 * `{source, args}` payload `TaskTriggerClient.runScan` sends to
 * titvo-task-trigger-aws's `/run-scan`. Mirrors the SAME `ScmStrategy`
 * pattern that repo itself already uses internally
 * (`trigger/src/app/scm/scm.interface.ts` — `supports`/`handle`) rather
 * than inventing a new shape, since it is solving the exact same "one
 * source, N provider-specific arg builders" problem.
 *
 * `TriggerScanUseCase` picks the first strategy whose `supports(provider)`
 * returns true; no match throws `UnsupportedProviderError` before any
 * config is read or any network call is made.
 */
export abstract class ScanTriggerStrategy {
  abstract supports (provider: string | undefined): boolean
  abstract buildRunScanPayload (repo: RepoItem, branch: string): Promise<RunScanPayload>
}
