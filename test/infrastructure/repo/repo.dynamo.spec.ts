import { describe, expect, it, vi } from 'vitest'
import { DynamoRepoRepository } from '@infrastructure/repo/repo.dynamo'

function buildClient (sendImpl: (command: any) => Promise<any>) {
  return { send: vi.fn(sendImpl) }
}

describe('DynamoRepoRepository.findAll', () => {
  it('returns an empty array when the table has no items (no-repos empty state)', async () => {
    const client = buildClient(async () => ({}))
    const repository = new DynamoRepoRepository(client as any, 'repository-table')

    expect(await repository.findAll()).toEqual([])
    expect(client.send.mock.calls[0][0].input.TableName).toBe('repository-table')
  })

  it('maps known-certain fields (repository_id, user_id) plus best-effort fields', async () => {
    const client = buildClient(async () => ({
      Items: [
        {
          repository_id: { S: 'repo-1' },
          user_id: { S: 'user-1' },
          name: { S: 'titvo-rag-indexer' },
          url: { S: 'https://github.com/org/repo' },
          provider: { S: 'github' },
          created_at: { S: '2026-01-01T00:00:00.000Z' }
        }
      ]
    }))
    const repository = new DynamoRepoRepository(client as any, 'repository-table')

    const result = await repository.findAll()

    expect(result).toEqual([{
      repositoryId: 'repo-1',
      userId: 'user-1',
      name: 'titvo-rag-indexer',
      url: 'https://github.com/org/repo',
      provider: 'github',
      createdAt: '2026-01-01T00:00:00.000Z'
    }])
  })

  it('never crashes on missing/unexpected attributes (defensive mapper, risk resolution #3)', async () => {
    const client = buildClient(async () => ({
      Items: [
        { repository_id: { S: 'repo-orphan-fields' } },
        { repository_id: { S: 'repo-weird' }, name: { N: '123' } }
      ]
    }))
    const repository = new DynamoRepoRepository(client as any, 'repository-table')

    const result = await repository.findAll()

    expect(result).toEqual([
      { repositoryId: 'repo-orphan-fields', userId: undefined, name: undefined, url: undefined, provider: undefined, createdAt: undefined },
      { repositoryId: 'repo-weird', userId: undefined, name: undefined, url: undefined, provider: undefined, createdAt: undefined }
    ])
  })
})

describe('createRepoRepository', () => {
  it('is exported and returns a RepoRepository instance', async () => {
    const { createRepoRepository } = await import('@infrastructure/repo/repo.dynamo')
    const repository = createRepoRepository({ tableName: 'repository-table', awsStage: 'localstack', awsEndpoint: 'http://localhost:4566' })
    expect(repository).toBeInstanceOf(DynamoRepoRepository)
  })
})
