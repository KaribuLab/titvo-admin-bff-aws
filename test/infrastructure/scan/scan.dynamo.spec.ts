import { describe, expect, it, vi } from 'vitest'
import { DynamoScanRepository } from '@infrastructure/scan/scan.dynamo'

function buildClient (sendImpl: (command: any) => Promise<any>) {
  return { send: vi.fn(sendImpl) }
}

const scanItemA = {
  scan_id: { S: 'scan-2' },
  repository_id: { S: 'repo-1' },
  status: { S: 'SUCCESS' },
  source: { S: 'github' },
  branch: { S: 'main' },
  created_at: { S: '2026-01-02T00:00:00.000Z' },
  updated_at: { S: '2026-01-02T00:05:00.000Z' },
  job_id: { S: 'job-2' }
}

const scanItemB = {
  scan_id: { S: 'scan-1' },
  repository_id: { S: 'repo-1' },
  status: { S: 'FAILED' },
  source: { S: 'github' },
  branch: { S: 'main' },
  created_at: { S: '2026-01-01T00:00:00.000Z' },
  updated_at: { S: '2026-01-01T00:05:00.000Z' },
  job_id: { S: 'job-1' }
}

describe('DynamoScanRepository.findLatestByRepositoryId', () => {
  it('queries repository_id_index desc with Limit 1 and maps the item', async () => {
    const client = buildClient(async () => ({ Items: [scanItemA] }))
    const repository = new DynamoScanRepository(client as any, 'task-table')

    const result = await repository.findLatestByRepositoryId('repo-1')

    expect(result).toEqual({
      scanId: 'scan-2',
      repositoryId: 'repo-1',
      status: 'SUCCESS',
      source: 'github',
      branch: 'main',
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:05:00.000Z',
      jobId: 'job-2'
    })
    const command = client.send.mock.calls[0][0]
    expect(command.input.IndexName).toBe('repository_id_index')
    expect(command.input.ScanIndexForward).toBe(false)
    expect(command.input.Limit).toBe(1)
    expect(command.input.KeyConditionExpression).toContain('repository_id')
  })

  it('returns null when the repo has never been scanned (empty Items)', async () => {
    const client = buildClient(async () => ({ Items: [] }))
    const repository = new DynamoScanRepository(client as any, 'task-table')

    expect(await repository.findLatestByRepositoryId('repo-never-scanned')).toBeNull()
  })

  it('degrades to null (not a 500) when the GSI is still CREATING (ResourceNotFoundException)', async () => {
    const client = buildClient(async () => { throw Object.assign(new Error('index not ready'), { name: 'ResourceNotFoundException' }) })
    const repository = new DynamoScanRepository(client as any, 'task-table')

    expect(await repository.findLatestByRepositoryId('repo-1')).toBeNull()
  })

  it('propagates an unrelated error unchanged (not masked as index-not-ready)', async () => {
    const client = buildClient(async () => { throw new Error('dynamodb unavailable') })
    const repository = new DynamoScanRepository(client as any, 'task-table')

    await expect(repository.findLatestByRepositoryId('repo-1')).rejects.toThrow('dynamodb unavailable')
  })
})

describe('DynamoScanRepository.findAllByRepositoryId', () => {
  it('returns all scans for a repo, newest first, with no Limit', async () => {
    const client = buildClient(async () => ({ Items: [scanItemA, scanItemB] }))
    const repository = new DynamoScanRepository(client as any, 'task-table')

    const result = await repository.findAllByRepositoryId('repo-1')

    expect(result).toEqual([
      expect.objectContaining({ scanId: 'scan-2' }),
      expect.objectContaining({ scanId: 'scan-1' })
    ])
    expect(client.send.mock.calls[0][0].input.Limit).toBeUndefined()
  })

  it('returns an empty array for an orphan repository_id (no matching scans)', async () => {
    const client = buildClient(async () => ({ Items: [] }))
    const repository = new DynamoScanRepository(client as any, 'task-table')

    expect(await repository.findAllByRepositoryId('repo-orphan')).toEqual([])
  })

  it('degrades to an empty array (not a 500) when the GSI is still CREATING', async () => {
    const client = buildClient(async () => { throw Object.assign(new Error('index not ready'), { name: 'ResourceNotFoundException' }) })
    const repository = new DynamoScanRepository(client as any, 'task-table')

    expect(await repository.findAllByRepositoryId('repo-1')).toEqual([])
  })
})

describe('DynamoScanRepository.findById', () => {
  it('gets the item by scan_id (base table GetItem) and maps detail fields incl. args/result', async () => {
    const client = buildClient(async () => ({
      Item: { ...scanItemA, args: { M: { target: { S: 'repo-1' } } }, scan_result: { M: { findings: { N: '0' } } } }
    }))
    const repository = new DynamoScanRepository(client as any, 'task-table')

    const result = await repository.findById('scan-2')

    expect(result).toEqual({
      scanId: 'scan-2',
      repositoryId: 'repo-1',
      status: 'SUCCESS',
      source: 'github',
      branch: 'main',
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:05:00.000Z',
      jobId: 'job-2',
      args: { target: 'repo-1' },
      result: { findings: 0 }
    })
    expect(client.send.mock.calls[0][0].input.Key).toEqual({ scan_id: { S: 'scan-2' } })
  })

  it('returns null when the scan does not exist', async () => {
    const client = buildClient(async () => ({}))
    const repository = new DynamoScanRepository(client as any, 'task-table')

    expect(await repository.findById('missing-scan')).toBeNull()
  })
})

describe('createScanRepository', () => {
  it('is exported and returns a ScanRepository instance', async () => {
    const { createScanRepository } = await import('@infrastructure/scan/scan.dynamo')
    const repository = createScanRepository({ taskTableName: 'task-table', awsStage: 'localstack', awsEndpoint: 'http://localhost:4566' })
    expect(repository).toBeInstanceOf(DynamoScanRepository)
  })
})


describe('measured execution through DynamoDB and the HTTP response', () => {
  it('preserves a failed security evaluation while exposing completed execution', async () => {
    const item = { ...scanItemB, result: { M: { coverage: { M: { complete: { BOOL: true } } }, issues_count: { N: '3' } } } }
    const client = buildClient(async () => ({ Item: item, Items: [item] }))
    const repository = new DynamoScanRepository(client as any, 'task-table')
    const detail = await repository.findById('scan-1')
    expect(detail).toMatchObject({ status: 'FAILED', executionStatus: 'COMPLETED', result: { issues_count: 3 } })
    const { handleGetScan, handleListScansForRepo } = await import('@infrastructure/scan/scans.handler')
    const response = await handleGetScan({ execute: async () => detail } as any, 'scan-1')
    expect(JSON.parse(response.body as string)).toMatchObject({ status: 'FAILED', execution_status: 'COMPLETED', result: { issues_count: 3 } })
    const listResponse = await handleListScansForRepo({ execute: async () => await repository.findAllByRepositoryId('repo-1') } as any, 'repo-1')
    expect(JSON.parse(listResponse.body as string).items[0]).toMatchObject({ status: 'FAILED', execution_status: 'COMPLETED' })
  })
})
