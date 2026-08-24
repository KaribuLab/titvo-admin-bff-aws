import { describe, expect, it, vi } from 'vitest'
import { ScanRepository } from '@core/scan/scan.repository'
import { ScanDetail } from '@core/scan/scan.entity'
import { GetScanUseCase } from '@app/scan/get-scan.use-case'

function buildScanRepository (findById: (id: string) => Promise<ScanDetail | null>): ScanRepository {
  return {
    findLatestByRepositoryId: vi.fn(),
    findAllByRepositoryId: vi.fn(),
    findById
  } as unknown as ScanRepository
}

describe('GetScanUseCase', () => {
  it('returns null when the scan does not exist (handler maps this to 404)', async () => {
    const useCase = new GetScanUseCase(buildScanRepository(async () => null))

    expect(await useCase.execute('missing-scan')).toBeNull()
  })

  it('returns the full scan detail including args/result', async () => {
    const detail: ScanDetail = { scanId: 'scan-1', repositoryId: 'repo-1', status: 'SUCCESS', args: { a: 1 }, result: { findings: 0 } }
    const useCase = new GetScanUseCase(buildScanRepository(async () => detail))

    expect(await useCase.execute('scan-1')).toEqual(detail)
  })

  it('does not need to resolve repository_id against the repository table (never 500s on an orphan repository_id)', async () => {
    const detail: ScanDetail = { scanId: 'scan-1', repositoryId: 'repo-does-not-exist', status: 'SUCCESS' }
    const useCase = new GetScanUseCase(buildScanRepository(async () => detail))

    expect(await useCase.execute('scan-1')).toEqual(detail)
  })
})
