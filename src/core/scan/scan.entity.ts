/**
 * Scan status values are owned by the scanning pipeline
 * (titvo-security-scan-infra-aws / the CI runner), not this BFF. The BFF
 * passes them through verbatim (e.g. `IN_PROGRESS`, `SUCCESS`, `FAILED`,
 * `TIMEOUT`) — never validates, renames, or maps them to a fixed enum.
 */
export type ScanStatus = string

/** List/summary shape — backs both the repo-scoped scan list and the `last_scan` embed on `GET /api/admin/repos`. */
export interface ScanSummary {
  scanId: string
  repositoryId: string
  status: ScanStatus
  source?: string
  branch?: string
  createdAt?: string
  updatedAt?: string
  jobId?: string
}

/** Full detail shape for `GET /api/admin/scans/:id` — adds the opaque `args`/`result` blobs. */
export interface ScanDetail extends ScanSummary {
  args?: unknown
  result?: unknown
}
