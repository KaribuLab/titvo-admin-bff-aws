import { describe, expect, it, vi } from 'vitest'
import { RepoRepository } from '@core/repo/repo.repository'
import { RepoItem } from '@core/repo/repo.entity'
import { ScanRepository } from '@core/scan/scan.repository'
import { ScanSummary } from '@core/scan/scan.entity'
import { ListReposUseCase } from '@app/repo/list-repos.use-case'

function buildRepoRepository (findAll: () => Promise<RepoItem[]>): RepoRepository {
  return { findAll } as unknown as RepoRepository
}

function buildScanRepository (findLatestByRepositoryId: (id: string) => Promise<ScanSummary | null>): ScanRepository {
  return {
    findLatestByRepositoryId,
    findAllByRepositoryId: vi.fn(),
    findById: vi.fn()
  } as unknown as ScanRepository
}

describe('ListReposUseCase', () => {
  it('returns an empty items array (not an error) when there are no repos', async () => {
    const useCase = new ListReposUseCase(buildRepoRepository(async () => []), buildScanRepository(async () => null))

    expect(await useCase.execute()).toEqual([])
  })

  it('renders lastScan: null for a repo that has never been scanned', async () => {
    const repoRepository = buildRepoRepository(async () => [{ repositoryId: 'repo-1', userId: 'u1', name: 'r1' }])
    const scanRepository = buildScanRepository(async () => null)
    const useCase = new ListReposUseCase(repoRepository, scanRepository)

    const result = await useCase.execute()

    expect(result).toEqual([{ repositoryId: 'repo-1', userId: 'u1', name: 'r1', lastScan: null }])
  })

  it('embeds the most recent scan per repo when one exists', async () => {
    const repoRepository = buildRepoRepository(async () => [{ repositoryId: 'repo-1' }])
    const lastScan: ScanSummary = { scanId: 'scan-9', repositoryId: 'repo-1', status: 'IN_PROGRESS', createdAt: 'a' }
    const scanRepository = buildScanRepository(async () => lastScan)
    const useCase = new ListReposUseCase(repoRepository, scanRepository)

    const result = await useCase.execute()

    expect(result).toEqual([{ repositoryId: 'repo-1', lastScan }])
  })

  it('never throws when the scan lookup degrades to null for every repo (GSI backfill window)', async () => {
    const repoRepository = buildRepoRepository(async () => [{ repositoryId: 'repo-1' }, { repositoryId: 'repo-2' }])
    const scanRepository = buildScanRepository(async () => null)
    const useCase = new ListReposUseCase(repoRepository, scanRepository)

    const result = await useCase.execute()

    expect(result).toEqual([
      { repositoryId: 'repo-1', lastScan: null },
      { repositoryId: 'repo-2', lastScan: null }
    ])
  })
})
