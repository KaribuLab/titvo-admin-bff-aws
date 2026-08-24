import { describe, expect, it, vi, beforeEach } from 'vitest'
import axios from 'axios'
import { AxiosBitbucketApiClient } from '@infrastructure/scan/bitbucket-api.axios-client'
import { BranchResolutionError } from '@app/scan/scan-trigger.error'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn()
  }
}))

describe('AxiosBitbucketApiClient', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset()
  })

  describe('resolveBranchCommit', () => {
    it('resolves a branch to its commit hash via GET /repositories/:workspace/:repo/refs/branches/:branch', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { target: { hash: 'c'.repeat(40) } } } as any)
      const client = new AxiosBitbucketApiClient()

      const hash = await client.resolveBranchCommit('karibu', 'titvo-legacy', 'tok-123', 'main')

      expect(hash).toBe('c'.repeat(40))
      expect(axios.get).toHaveBeenCalledWith(
        'https://api.bitbucket.org/2.0/repositories/karibu/titvo-legacy/refs/branches/main',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Basic tok-123' })
        })
      )
    })

    it('does NOT use a Bearer header (Bitbucket Cloud needs Basic — mirrors titvo-git-commit-files-aws)', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { target: { hash: 'c'.repeat(40) } } } as any)
      const client = new AxiosBitbucketApiClient()

      await client.resolveBranchCommit('karibu', 'titvo-legacy', 'tok-123', 'main')

      const [, config] = vi.mocked(axios.get).mock.calls[0]
      expect((config as any).headers.Authorization).not.toMatch(/^Bearer /)
    })

    it('throws BranchResolutionError when the API call fails', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('404'))
      const client = new AxiosBitbucketApiClient()

      await expect(client.resolveBranchCommit('karibu', 'titvo-legacy', 'tok-123', 'no-such-branch')).rejects.toThrow(BranchResolutionError)
    })

    it('throws BranchResolutionError when the response has no target hash', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: {} } as any)
      const client = new AxiosBitbucketApiClient()

      await expect(client.resolveBranchCommit('karibu', 'titvo-legacy', 'tok-123', 'main')).rejects.toThrow(BranchResolutionError)
    })
  })

  describe('fetchProjectKey', () => {
    it('fetches the project key via GET /repositories/:workspace/:repo', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { project: { key: 'TVO' } } } as any)
      const client = new AxiosBitbucketApiClient()

      const key = await client.fetchProjectKey('karibu', 'titvo-legacy', 'tok-123')

      expect(key).toBe('TVO')
      expect(axios.get).toHaveBeenCalledWith(
        'https://api.bitbucket.org/2.0/repositories/karibu/titvo-legacy',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Basic tok-123' })
        })
      )
    })

    it('throws BranchResolutionError when the API call fails', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('403'))
      const client = new AxiosBitbucketApiClient()

      await expect(client.fetchProjectKey('karibu', 'titvo-legacy', 'tok-123')).rejects.toThrow(BranchResolutionError)
    })

    it('throws BranchResolutionError when the response has no project key', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: {} } as any)
      const client = new AxiosBitbucketApiClient()

      await expect(client.fetchProjectKey('karibu', 'titvo-legacy', 'tok-123')).rejects.toThrow(BranchResolutionError)
    })
  })

  describe('fetchDefaultBranch', () => {
    it('fetches the default branch via GET /repositories/:workspace/:repo, reading mainbranch.name', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { mainbranch: { name: 'master' } } } as any)
      const client = new AxiosBitbucketApiClient()

      const branch = await client.fetchDefaultBranch('karibu', 'titvo-legacy', 'tok-123')

      expect(branch).toBe('master')
      expect(axios.get).toHaveBeenCalledWith(
        'https://api.bitbucket.org/2.0/repositories/karibu/titvo-legacy',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Basic tok-123' }) })
      )
    })

    it('throws BranchResolutionError when the API call fails', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('403'))
      const client = new AxiosBitbucketApiClient()

      await expect(client.fetchDefaultBranch('karibu', 'titvo-legacy', 'tok-123')).rejects.toThrow(BranchResolutionError)
    })

    it('throws BranchResolutionError when the response has no mainbranch name', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: {} } as any)
      const client = new AxiosBitbucketApiClient()

      await expect(client.fetchDefaultBranch('karibu', 'titvo-legacy', 'tok-123')).rejects.toThrow(BranchResolutionError)
    })
  })
})
