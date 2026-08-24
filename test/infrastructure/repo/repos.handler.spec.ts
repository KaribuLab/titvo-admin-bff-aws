import { describe, expect, it, vi } from 'vitest'
import { handleListRepos } from '@infrastructure/repo/repos.handler'

describe('handleListRepos', () => {
  it('returns 200 {items:[]} when there are no repos (explicit empty state, not an error)', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue([]) }

    const result = await handleListRepos(useCase as any)

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body as string)).toEqual({ items: [] })
  })

  it('maps items to snake_case wire shape with last_scan: null for a never-scanned repo', async () => {
    const useCase = {
      execute: vi.fn().mockResolvedValue([
        { repositoryId: 'repo-1', name: 'r1', url: 'https://x', provider: 'github', lastScan: null }
      ])
    }

    const result = await handleListRepos(useCase as any)

    expect(JSON.parse(result.body as string)).toEqual({
      items: [{ repository_id: 'repo-1', name: 'r1', url: 'https://x', provider: 'github', last_scan: null }]
    })
  })

  it('maps last_scan to {scan_id, status, created_at} when a scan exists', async () => {
    const useCase = {
      execute: vi.fn().mockResolvedValue([
        {
          repositoryId: 'repo-1',
          lastScan: { scanId: 'scan-1', repositoryId: 'repo-1', status: 'IN_PROGRESS', createdAt: '2026-01-01T00:00:00.000Z' }
        }
      ])
    }

    const result = await handleListRepos(useCase as any)

    expect(JSON.parse(result.body as string)).toEqual({
      items: [{
        repository_id: 'repo-1',
        name: undefined,
        url: undefined,
        provider: undefined,
        last_scan: { scan_id: 'scan-1', status: 'IN_PROGRESS', created_at: '2026-01-01T00:00:00.000Z' }
      }]
    })
  })
})
