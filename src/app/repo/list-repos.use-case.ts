import { Injectable } from '@nestjs/common'
import { RepoRepository } from '@core/repo/repo.repository'
import { RepoItem } from '@core/repo/repo.entity'
import { ScanRepository } from '@core/scan/scan.repository'
import { ScanSummary } from '@core/scan/scan.entity'

/** Wire-ready list item for `GET /api/admin/repos` — the repo plus its most recent scan, or `null` when never scanned. */
export interface RepoListItem extends RepoItem {
  lastScan: ScanSummary | null
}

/**
 * Backs `GET /api/admin/repos`. Repos are platform-wide/team-internal
 * (decision #6, design D8-adjacent scope note) — this lists every repo,
 * never scoped per-user. `lastScan: null` covers BOTH "never scanned"
 * and "repository_id_index not ready yet" (GSI backfill window) — both
 * are non-error states and are deliberately indistinguishable at this
 * layer (spec: "Never scanned" renders, it is not an error).
 */
@Injectable()
export class ListReposUseCase {
  constructor (
    private readonly repoRepository: RepoRepository,
    private readonly scanRepository: ScanRepository
  ) {}

  async execute (): Promise<RepoListItem[]> {
    const repos = await this.repoRepository.findAll()

    const result: RepoListItem[] = []
    for (const repo of repos) {
      const lastScan = await this.scanRepository.findLatestByRepositoryId(repo.repositoryId)
      result.push({ ...repo, lastScan })
    }
    return result
  }
}
