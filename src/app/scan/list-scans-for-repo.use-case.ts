import { Injectable } from '@nestjs/common'
import { ScanRepository } from '@core/scan/scan.repository'
import { ScanSummary } from '@core/scan/scan.entity'

/**
 * Backs `GET /api/admin/repos/:id/scans`. Queries `task` directly by
 * `repository_id` (design D1/D2) — no join against `repository`, so an
 * orphan or unknown `:id` simply yields an empty list, never a 404/500
 * (spec edge case: "orphan repository_id").
 */
@Injectable()
export class ListScansForRepoUseCase {
  constructor (private readonly scanRepository: ScanRepository) {}

  async execute (repositoryId: string): Promise<ScanSummary[]> {
    return await this.scanRepository.findAllByRepositoryId(repositoryId)
  }
}
