import { ScanDetail, ScanSummary } from './scan.entity'

export abstract class ScanRepository {
  /**
   * Most recent scan for a repo (Query `repository_id_index`, Limit 1,
   * `ScanIndexForward: false` — design D2). Returns `null` both when the
   * repo has never been scanned AND when the index is still `CREATING`
   * during the GSI backfill window (design "Migration / rollout") — both
   * are non-error, non-500 states at this layer.
   */
  abstract findLatestByRepositoryId (repositoryId: string): Promise<ScanSummary | null>
  /** All scans for a repo, newest first. Empty array covers "never scanned", "orphan/unknown repository_id", AND "index not ready yet" — all degrade the same way, never a 500. */
  abstract findAllByRepositoryId (repositoryId: string): Promise<ScanSummary[]>
  /** Base-table `GetItem` by `scan_id` — does not resolve/join `repository_id` against the `repository` table. */
  abstract findById (scanId: string): Promise<ScanDetail | null>
}
