import { Injectable } from '@nestjs/common'
import { ScanRepository } from '@core/scan/scan.repository'
import { ScanDetail } from '@core/scan/scan.entity'

/**
 * Backs `GET /api/admin/scans/:id` — a plain base-table `GetItem`. Never
 * resolves `repository_id` against the `repository` table, so an orphan
 * `repository_id` on the scan never causes a 500 here.
 */
@Injectable()
export class GetScanUseCase {
  constructor (private readonly scanRepository: ScanRepository) {}

  async execute (scanId: string): Promise<ScanDetail | null> {
    return await this.scanRepository.findById(scanId)
  }
}
