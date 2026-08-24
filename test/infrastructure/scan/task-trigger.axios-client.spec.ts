import { describe, expect, it, vi, beforeEach } from 'vitest'
import axios from 'axios'
import { AxiosTaskTriggerClient } from '@infrastructure/scan/task-trigger.axios-client'
import { UpstreamScanTriggerError } from '@app/scan/scan-trigger.error'
import { RunScanPayload } from '@core/scan/task-trigger.client'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn()
  }
}))

const githubPayload: RunScanPayload = {
  source: 'github',
  args: {
    repository_url: 'https://github.com/KaribuLab/titvo-rag-indexer',
    github_token: 'tok-123',
    github_repo_name: 'KaribuLab/titvo-rag-indexer',
    github_commit_sha: 'a'.repeat(40),
    github_assignee: 'octocat',
    github_branch: 'main'
  }
}

const bitbucketPayload: RunScanPayload = {
  source: 'bitbucket',
  args: {
    repository_url: 'https://bitbucket.org/karibu/titvo-legacy',
    bitbucket_workspace: 'karibu',
    bitbucket_repo_slug: 'titvo-legacy',
    bitbucket_project_key: 'TVO',
    bitbucket_commit: 'b'.repeat(40),
    bitbucket_branch: 'main'
  }
}

describe('AxiosTaskTriggerClient', () => {
  beforeEach(() => {
    vi.mocked(axios.post).mockReset()
  })

  it('POSTs {source, args} to {baseUrl}/run-scan with the service API key as X-Api-Key, for a github payload', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({ data: { message: 'Scan starting', scan_id: 'scan-abc' } } as any)
    const client = new AxiosTaskTriggerClient('https://task-trigger.example.com/v1')

    const result = await client.runScan('svc-key-123', githubPayload)

    expect(result).toEqual({ scanId: 'scan-abc', message: 'Scan starting' })
    expect(axios.post).toHaveBeenCalledWith(
      'https://task-trigger.example.com/v1/run-scan',
      { source: 'github', args: githubPayload.args },
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Api-Key': 'svc-key-123' })
      })
    )
  })

  it('POSTs a bitbucket payload with source:"bitbucket" — the SAME client and endpoint serve both providers', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({ data: { message: 'Scan starting', scan_id: 'scan-def' } } as any)
    const client = new AxiosTaskTriggerClient('https://task-trigger.example.com/v1')

    const result = await client.runScan('svc-key-123', bitbucketPayload)

    expect(result).toEqual({ scanId: 'scan-def', message: 'Scan starting' })
    expect(axios.post).toHaveBeenCalledWith(
      'https://task-trigger.example.com/v1/run-scan',
      { source: 'bitbucket', args: bitbucketPayload.args },
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Api-Key': 'svc-key-123' })
      })
    )
  })

  it('throws UpstreamScanTriggerError (never the raw upstream body) when the call fails', async () => {
    vi.mocked(axios.post).mockRejectedValueOnce(new Error('network error'))
    const client = new AxiosTaskTriggerClient('https://task-trigger.example.com/v1')

    const error = await client.runScan('svc-key-123', githubPayload).catch(e => e)

    expect(error).toBeInstanceOf(UpstreamScanTriggerError)
    expect(String(error)).not.toContain('network error')
  })
})
