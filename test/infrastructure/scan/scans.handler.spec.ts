import { describe, expect, it, vi } from 'vitest'
import { APIGatewayProxyEventV2 } from 'aws-lambda'
import { ValidatedSession } from '@titvo/auth'
import { handleListScansForRepo, handleGetScan, handleTriggerScan, handleGetDefaultBranch } from '@infrastructure/scan/scans.handler'
import {
  RepoNotFoundError,
  UnsupportedProviderError,
  RepoUrlInvalidError,
  ConfigMissingError,
  BranchResolutionError,
  UpstreamScanTriggerError
} from '@app/scan/scan-trigger.error'

function buildEvent (body?: unknown): APIGatewayProxyEventV2 {
  return { body: body === undefined ? undefined : JSON.stringify(body) } as unknown as APIGatewayProxyEventV2
}

const adminSession: ValidatedSession = { userId: 'u1', email: 'admin@titvo.dev', role: 'admin' }
const memberSession: ValidatedSession = { userId: 'u2', email: 'member@titvo.dev', role: 'member' }

describe('handleListScansForRepo', () => {
  it('returns 200 {items:[]} for a repo with no scans / an orphan repository_id (no error)', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue([]) }

    const result = await handleListScansForRepo(useCase as any, 'repo-orphan')

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body as string)).toEqual({ items: [] })
    expect(useCase.execute).toHaveBeenCalledWith('repo-orphan')
  })

  it('maps scans to the snake_case wire shape, newest first', async () => {
    const useCase = {
      execute: vi.fn().mockResolvedValue([
        { scanId: 'scan-2', repositoryId: 'repo-1', status: 'SUCCESS', source: 'github', branch: 'main', createdAt: 'b', updatedAt: 'b2' },
        { scanId: 'scan-1', repositoryId: 'repo-1', status: 'FAILED', source: 'github', branch: 'main', createdAt: 'a', updatedAt: 'a2' }
      ])
    }

    const result = await handleListScansForRepo(useCase as any, 'repo-1')

    expect(JSON.parse(result.body as string)).toEqual({
      items: [
        { scan_id: 'scan-2', status: 'SUCCESS', source: 'github', branch: 'main', created_at: 'b', updated_at: 'b2' },
        { scan_id: 'scan-1', status: 'FAILED', source: 'github', branch: 'main', created_at: 'a', updated_at: 'a2' }
      ]
    })
  })
})

describe('handleGetScan', () => {
  it('returns 404 not_found when the scan does not exist', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue(null) }

    const result = await handleGetScan(useCase as any, 'missing-scan')

    expect(result.statusCode).toBe(404)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'not_found' })
  })

  it('returns the full scan detail with snake_case fields incl. args/result', async () => {
    const useCase = {
      execute: vi.fn().mockResolvedValue({
        scanId: 'scan-1',
        repositoryId: 'repo-1',
        status: 'SUCCESS',
        source: 'github',
        branch: 'main',
        args: { target: 'repo-1' },
        result: { findings: 0 },
        createdAt: 'a',
        updatedAt: 'a2'
      })
    }

    const result = await handleGetScan(useCase as any, 'scan-1')

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body as string)).toEqual({
      scan_id: 'scan-1',
      repository_id: 'repo-1',
      status: 'SUCCESS',
      source: 'github',
      branch: 'main',
      args: { target: 'repo-1' },
      result: { findings: 0 },
      created_at: 'a',
      updated_at: 'a2'
    })
  })
})

describe('handleTriggerScan', () => {
  it('rejects a member with 403 forbidden and never calls the use-case', async () => {
    const useCase = { execute: vi.fn() }

    const result = await handleTriggerScan(useCase as any, buildEvent({ branch: 'main' }), 'repo-1', memberSession)

    expect(result.statusCode).toBe(403)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'forbidden' })
    expect(useCase.execute).not.toHaveBeenCalled()
  })

  it('returns 400 invalid_request when branch is missing', async () => {
    const useCase = { execute: vi.fn() }

    const result = await handleTriggerScan(useCase as any, buildEvent({}), 'repo-1', adminSession)

    expect(result.statusCode).toBe(400)
    expect(useCase.execute).not.toHaveBeenCalled()
  })

  it('returns 400 invalid_request when branch is blank', async () => {
    const useCase = { execute: vi.fn() }

    const result = await handleTriggerScan(useCase as any, buildEvent({ branch: '   ' }), 'repo-1', adminSession)

    expect(result.statusCode).toBe(400)
    expect(useCase.execute).not.toHaveBeenCalled()
  })

  it('allows an admin to trigger a scan, returning 200 with the new scan_id', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue({ scanId: 'scan-999' }) }

    const result = await handleTriggerScan(useCase as any, buildEvent({ branch: 'main' }), 'repo-1', adminSession)

    expect(result.statusCode).toBe(200)
    expect(useCase.execute).toHaveBeenCalledWith({ repositoryId: 'repo-1', branch: 'main' })
    expect(JSON.parse(result.body as string)).toEqual({ scan_id: 'scan-999' })
  })

  it('includes a "warning" field in the 200 response when the use-case flags a repositoryId mismatch (still 200 — non-blocking)', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue({ scanId: 'scan-999', repositoryIdWarning: "This scan won't be linked to this repository's existing history..." }) }

    const result = await handleTriggerScan(useCase as any, buildEvent({ branch: 'main' }), 'repo-1', adminSession)

    expect(result.statusCode).toBe(200)
    const parsed = JSON.parse(result.body as string)
    expect(parsed.scan_id).toBe('scan-999')
    expect(parsed.warning).toContain("won't be linked")
  })

  it('omits the "warning" field entirely when the use-case has none (no false-positive noise)', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue({ scanId: 'scan-999', repositoryIdWarning: undefined }) }

    const result = await handleTriggerScan(useCase as any, buildEvent({ branch: 'main' }), 'repo-1', adminSession)

    const parsed = JSON.parse(result.body as string)
    expect(parsed).not.toHaveProperty('warning')
  })

  it('returns 404 not_found when the repo does not exist', async () => {
    const useCase = { execute: vi.fn().mockRejectedValue(new RepoNotFoundError('missing')) }

    const result = await handleTriggerScan(useCase as any, buildEvent({ branch: 'main' }), 'missing', adminSession)

    expect(result.statusCode).toBe(404)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'not_found' })
  })

  it('returns 422 unsupported_provider for a non-github repo', async () => {
    const useCase = { execute: vi.fn().mockRejectedValue(new UnsupportedProviderError('bitbucket not supported')) }

    const result = await handleTriggerScan(useCase as any, buildEvent({ branch: 'main' }), 'repo-1', adminSession)

    expect(result.statusCode).toBe(422)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'unsupported_provider', message: 'bitbucket not supported' })
  })

  it('returns 422 invalid_repository_url when the repo has no usable url', async () => {
    const useCase = { execute: vi.fn().mockRejectedValue(new RepoUrlInvalidError('no url')) }

    const result = await handleTriggerScan(useCase as any, buildEvent({ branch: 'main' }), 'repo-1', adminSession)

    expect(result.statusCode).toBe(422)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'invalid_repository_url', message: 'no url' })
  })

  it('returns 422 config_missing naming the exact missing parameter (decision #4: actionable, not a cryptic 500)', async () => {
    const useCase = { execute: vi.fn().mockRejectedValue(new ConfigMissingError('default_github_assignee')) }

    const result = await handleTriggerScan(useCase as any, buildEvent({ branch: 'main' }), 'repo-1', adminSession)

    expect(result.statusCode).toBe(422)
    const parsed = JSON.parse(result.body as string)
    expect(parsed.error).toBe('config_missing')
    expect(parsed.parameter_id).toBe('default_github_assignee')
    expect(parsed.message).toContain('default_github_assignee')
  })

  it('returns 422 branch_resolution_failed when GitHub cannot resolve the branch', async () => {
    const useCase = { execute: vi.fn().mockRejectedValue(new BranchResolutionError('branch not found')) }

    const result = await handleTriggerScan(useCase as any, buildEvent({ branch: 'no-such-branch' }), 'repo-1', adminSession)

    expect(result.statusCode).toBe(422)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'branch_resolution_failed', message: 'branch not found' })
  })

  it('returns 502 upstream_error (never the raw upstream body) when task-trigger-aws fails', async () => {
    const useCase = { execute: vi.fn().mockRejectedValue(new UpstreamScanTriggerError('Failed to trigger scan on the task-trigger service')) }

    const result = await handleTriggerScan(useCase as any, buildEvent({ branch: 'main' }), 'repo-1', adminSession)

    expect(result.statusCode).toBe(502)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'upstream_error', message: 'Failed to trigger scan on the task-trigger service' })
  })

  it('passes a valid scan_mode through to the use-case (full scan toggle)', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue({ scanId: 'scan-999' }) }

    const result = await handleTriggerScan(useCase as any, buildEvent({ branch: 'main', scan_mode: 'full' }), 'repo-1', adminSession)

    expect(result.statusCode).toBe(200)
    expect(useCase.execute).toHaveBeenCalledWith({ repositoryId: 'repo-1', branch: 'main', scanMode: 'full' })
  })

  it('defaults scan_mode to undefined (task-trigger-aws\'s own "commit" default applies) when omitted', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue({ scanId: 'scan-999' }) }

    await handleTriggerScan(useCase as any, buildEvent({ branch: 'main' }), 'repo-1', adminSession)

    expect(useCase.execute).toHaveBeenCalledWith({ repositoryId: 'repo-1', branch: 'main', scanMode: undefined })
  })

  it('returns 400 invalid_request for an unrecognized scan_mode value, never calling the use-case', async () => {
    const useCase = { execute: vi.fn() }

    const result = await handleTriggerScan(useCase as any, buildEvent({ branch: 'main', scan_mode: 'deep' }), 'repo-1', adminSession)

    expect(result.statusCode).toBe(400)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'invalid_request', message: 'scan_mode must be one of: commit, full' })
    expect(useCase.execute).not.toHaveBeenCalled()
  })
})

describe('handleGetDefaultBranch', () => {
  it('rejects a member with 403 forbidden and never calls the use-case', async () => {
    const useCase = { execute: vi.fn() }

    const result = await handleGetDefaultBranch(useCase as any, 'repo-1', memberSession)

    expect(result.statusCode).toBe(403)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'forbidden' })
    expect(useCase.execute).not.toHaveBeenCalled()
  })

  it('returns 200 {branch} for an admin', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue({ branch: 'develop' }) }

    const result = await handleGetDefaultBranch(useCase as any, 'repo-1', adminSession)

    expect(result.statusCode).toBe(200)
    expect(useCase.execute).toHaveBeenCalledWith('repo-1')
    expect(JSON.parse(result.body as string)).toEqual({ branch: 'develop' })
  })

  it('returns 404 not_found when the repo does not exist', async () => {
    const useCase = { execute: vi.fn().mockRejectedValue(new RepoNotFoundError('missing')) }

    const result = await handleGetDefaultBranch(useCase as any, 'missing', adminSession)

    expect(result.statusCode).toBe(404)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'not_found' })
  })

  it('returns 422 config_missing naming the exact missing parameter', async () => {
    const useCase = { execute: vi.fn().mockRejectedValue(new ConfigMissingError('bitbucket_api_token')) }

    const result = await handleGetDefaultBranch(useCase as any, 'repo-1', adminSession)

    expect(result.statusCode).toBe(422)
    const parsed = JSON.parse(result.body as string)
    expect(parsed.error).toBe('config_missing')
    expect(parsed.parameter_id).toBe('bitbucket_api_token')
  })

  it('returns 422 branch_resolution_failed when the provider API cannot resolve the default branch', async () => {
    const useCase = { execute: vi.fn().mockRejectedValue(new BranchResolutionError('could not determine default branch')) }

    const result = await handleGetDefaultBranch(useCase as any, 'repo-1', adminSession)

    expect(result.statusCode).toBe(422)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'branch_resolution_failed', message: 'could not determine default branch' })
  })
})
