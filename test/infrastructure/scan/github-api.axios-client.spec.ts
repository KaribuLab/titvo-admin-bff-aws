import { describe, expect, it, vi, beforeEach } from 'vitest'
import axios from 'axios'
import { AxiosGithubApiClient } from '@infrastructure/scan/github-api.axios-client'
import { BranchResolutionError, RepoUrlInvalidError } from '@app/scan/scan-trigger.error'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn()
  }
}))

describe('AxiosGithubApiClient', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockReset()
  })

  it('resolves a branch to its commit SHA via GET /repos/:owner/:repo/git/ref/heads/:branch', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { object: { sha: 'c'.repeat(40) } } } as any)
    const client = new AxiosGithubApiClient()

    const sha = await client.resolveBranchSha('https://github.com/KaribuLab/titvo-rag-indexer', 'tok-123', 'main')

    expect(sha).toBe('c'.repeat(40))
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.github.com/repos/KaribuLab/titvo-rag-indexer/git/ref/heads/main',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer tok-123',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        })
      })
    )
  })

  it('URL-encodes a branch name containing slashes', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { object: { sha: 'd'.repeat(40) } } } as any)
    const client = new AxiosGithubApiClient()

    await client.resolveBranchSha('https://github.com/KaribuLab/titvo-rag-indexer', 'tok-123', 'feature/x')

    expect(axios.get).toHaveBeenCalledWith(
      'https://api.github.com/repos/KaribuLab/titvo-rag-indexer/git/ref/heads/feature%2Fx',
      expect.anything()
    )
  })

  it('throws BranchResolutionError when the GitHub API call fails', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('404'))
    const client = new AxiosGithubApiClient()

    await expect(client.resolveBranchSha('https://github.com/KaribuLab/titvo-rag-indexer', 'tok-123', 'no-such-branch')).rejects.toThrow(BranchResolutionError)
  })

  it('throws BranchResolutionError when the response has no sha', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: {} } as any)
    const client = new AxiosGithubApiClient()

    await expect(client.resolveBranchSha('https://github.com/KaribuLab/titvo-rag-indexer', 'tok-123', 'main')).rejects.toThrow(BranchResolutionError)
  })

  it('throws RepoUrlInvalidError before ever calling GitHub when the URL is not a github.com URL', async () => {
    const client = new AxiosGithubApiClient()

    await expect(client.resolveBranchSha('https://bitbucket.org/a/b', 'tok-123', 'main')).rejects.toThrow(RepoUrlInvalidError)
    expect(axios.get).not.toHaveBeenCalled()
  })

  describe('fetchDefaultBranch', () => {
    it('fetches the default branch via GET /repos/:owner/:repo', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { default_branch: 'develop' } } as any)
      const client = new AxiosGithubApiClient()

      const branch = await client.fetchDefaultBranch('https://github.com/KaribuLab/titvo-rag-indexer', 'tok-123')

      expect(branch).toBe('develop')
      expect(axios.get).toHaveBeenCalledWith(
        'https://api.github.com/repos/KaribuLab/titvo-rag-indexer',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok-123' }) })
      )
    })

    it('throws BranchResolutionError when the API call fails', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('404'))
      const client = new AxiosGithubApiClient()

      await expect(client.fetchDefaultBranch('https://github.com/KaribuLab/titvo-rag-indexer', 'tok-123')).rejects.toThrow(BranchResolutionError)
    })

    it('throws BranchResolutionError when the response has no default_branch', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: {} } as any)
      const client = new AxiosGithubApiClient()

      await expect(client.fetchDefaultBranch('https://github.com/KaribuLab/titvo-rag-indexer', 'tok-123')).rejects.toThrow(BranchResolutionError)
    })
  })
})
