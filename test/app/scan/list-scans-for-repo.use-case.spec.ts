import { describe, expect, it, vi } from 'vitest'
import { ScanRepository } from '@core/scan/scan.repository'
import { ScanSummary } from '@core/scan/scan.entity'
import { ListScansForRepoUseCase } from '@app/scan/list-scans-for-repo.use-case'

function buildScanRepository (findAllByRepositoryId: (id: string) => Promise<ScanSummary[]>): ScanRepository {
  return {
    findLatestByRepositoryId: vi.fn(),
    findAllByRepositoryId,
    findById: vi.fn()
  } as unknown as ScanRepository
}

describe('ListScansForRepoUseCase', () => {
  it('returns the scans for a repo as-is (repository already queries newest-first)', async () => {
    const scans: ScanSummary[] = [
      { scanId: 'scan-2', repositoryId: 'repo-1', status: 'SUCCESS' },
      { scanId: 'scan-1', repositoryId: 'repo-1', status: 'FAILED' }
    ]
    const useCase = new ListScansForRepoUseCase(buildScanRepository(async () => scans))

    expect(await useCase.execute('repo-1')).toEqual(scans)
  })

  it('returns an empty array for an orphan/unknown repository_id (no error)', async () => {
    const useCase = new ListScansForRepoUseCase(buildScanRepository(async () => []))

    expect(await useCase.execute('repo-orphan')).toEqual([])
  })

  it('passes distinct statuses through untouched (IN_PROGRESS/FAILED/TIMEOUT render distinctly)', async () => {
    const scans: ScanSummary[] = [
      { scanId: 'scan-3', repositoryId: 'repo-1', status: 'IN_PROGRESS' },
      { scanId: 'scan-2', repositoryId: 'repo-1', status: 'TIMEOUT' },
      { scanId: 'scan-1', repositoryId: 'repo-1', status: 'FAILED' }
    ]
    const useCase = new ListScansForRepoUseCase(buildScanRepository(async () => scans))

    const result = await useCase.execute('repo-1')

    expect(result.map(item => item.status)).toEqual(['IN_PROGRESS', 'TIMEOUT', 'FAILED'])
  })
})
