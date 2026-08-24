/**
 * The `{source, args}` shape titvo-task-trigger-aws's `POST /run-scan`
 * requires — confirmed against `trigger/src/app/scm/github.strategy.ts` and
 * `trigger/src/app/scm/bitbucket.strategy.ts` in titvo-task-trigger-aws (the
 * exact same production endpoint GitHub Actions/Bitbucket Pipelines already
 * call). `args` is intentionally untyped here (`Record<string, string>`) —
 * its exact keys are owned by each `ScanTriggerStrategy`
 * (`GithubScanTriggerStrategy`/`BitbucketScanTriggerStrategy`), since the
 * two providers require entirely different fields. `scan_mode` is
 * deliberately omitted (decision: leave unset/default `"commit"` for this
 * feature).
 */
export interface RunScanPayload {
  source: string
  args: Record<string, string>
}

export interface RunScanResult {
  message: string
  scanId: string
}

/**
 * Port for calling titvo-task-trigger-aws's `POST /run-scan` — the SAME
 * production endpoint the existing GitHub Action/Bitbucket Pipeline
 * integration already calls, authenticated with the BFF's own
 * service-to-service API key (decision #6: a normal admin-issued key,
 * stored as the `bff_scan_trigger_api_key` config secret — not a new
 * key-issuing mechanism). Provider-agnostic: the same client and endpoint
 * serve both GitHub and Bitbucket payloads.
 */
export abstract class TaskTriggerClient {
  abstract runScan (apiKey: string, payload: RunScanPayload): Promise<RunScanResult>
}
