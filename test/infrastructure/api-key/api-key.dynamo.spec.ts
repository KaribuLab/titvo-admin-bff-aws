import { describe, expect, it, vi } from 'vitest'
import { DynamoApiKeyRepository } from '@infrastructure/api-key/api-key.dynamo'
import { ApiKeyNotFoundError } from '@titvo/auth'

function buildClient (sendImpl: (command: any) => Promise<any>) {
  return { send: vi.fn(sendImpl) }
}

describe('DynamoApiKeyRepository.findAll', () => {
  it('returns an empty array when the table has no items', async () => {
    const client = buildClient(async () => ({}))
    const repository = new DynamoApiKeyRepository(client as any, 'apikey-table', 'prod')

    expect(await repository.findAll()).toEqual([])
    expect(client.send.mock.calls[0][0].input.TableName).toBe('apikey-table')
  })

  it('maps every attribute including legacy items with no status/label (backward-compat D5)', async () => {
    const client = buildClient(async () => ({
      Items: [
        {
          key_id: { S: 'k1' },
          user_id: { S: 'u1' },
          api_key: { S: 'hash1' },
          label: { S: 'ci-runner' },
          status: { S: 'active' },
          created_at: { S: 'a' },
          created_by: { S: 'admin@titvo.dev' }
        },
        { key_id: { S: 'legacy' }, user_id: { S: 'u2' }, api_key: { S: 'hash2' } }
      ]
    }))
    const repository = new DynamoApiKeyRepository(client as any, 'apikey-table', 'prod')

    const result = await repository.findAll()

    expect(result).toEqual([
      { keyId: 'k1', userId: 'u1', apiKey: 'hash1', label: 'ci-runner', status: 'active', createdAt: 'a', createdBy: 'admin@titvo.dev', revokedAt: undefined, lastUsedAt: undefined },
      { keyId: 'legacy', userId: 'u2', apiKey: 'hash2', label: undefined, status: undefined, createdAt: undefined, createdBy: undefined, revokedAt: undefined, lastUsedAt: undefined }
    ])
  })
})

describe('DynamoApiKeyRepository.create', () => {
  it('puts the full item, persisting only the hash (never raw key material)', async () => {
    const client = buildClient(async () => ({}))
    const repository = new DynamoApiKeyRepository(client as any, 'apikey-table', 'prod')

    await repository.create({
      keyId: 'k1',
      userId: 'admin-1',
      apiKey: 'hashed-value',
      label: 'ci-runner',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'admin@titvo.dev'
    })

    const command = client.send.mock.calls[0][0]
    expect(command.input.TableName).toBe('apikey-table')
    expect(command.input.Item).toEqual({
      key_id: { S: 'k1' },
      user_id: { S: 'admin-1' },
      api_key: { S: 'hashed-value' },
      label: { S: 'ci-runner' },
      status: { S: 'active' },
      created_at: { S: '2026-01-01T00:00:00.000Z' },
      created_by: { S: 'admin@titvo.dev' }
    })
  })
})

describe('DynamoApiKeyRepository.revoke', () => {
  it('sets status=revoked and revoked_at, returning the updated entity', async () => {
    const client = buildClient(async () => ({
      Attributes: { key_id: { S: 'k1' }, user_id: { S: 'u1' }, api_key: { S: 'hash1' }, status: { S: 'revoked' }, revoked_at: { S: '2026-02-01T00:00:00.000Z' } }
    }))
    const repository = new DynamoApiKeyRepository(client as any, 'apikey-table', 'prod')

    const result = await repository.revoke('k1')

    const command = client.send.mock.calls[0][0]
    expect(command.input.Key).toEqual({ key_id: { S: 'k1' } })
    expect(command.input.ConditionExpression).toBe('attribute_exists(#key_id)')
    expect(command.input.ExpressionAttributeValues[':status']).toEqual({ S: 'revoked' })
    expect(result.status).toBe('revoked')
  })

  it('translates a ConditionalCheckFailedException into ApiKeyNotFoundError (no phantom item creation)', async () => {
    const conditionalError = Object.assign(new Error('missing'), { name: 'ConditionalCheckFailedException' })
    const client = buildClient(async () => { throw conditionalError })
    const repository = new DynamoApiKeyRepository(client as any, 'apikey-table', 'prod')

    await expect(repository.revoke('missing')).rejects.toThrow(ApiKeyNotFoundError)
  })

  it('propagates an unrelated error unchanged (not masked as not-found)', async () => {
    const client = buildClient(async () => { throw new Error('dynamodb unavailable') })
    const repository = new DynamoApiKeyRepository(client as any, 'apikey-table', 'prod')

    await expect(repository.revoke('k1')).rejects.toThrow('dynamodb unavailable')
  })
})

describe('DynamoApiKeyRepository.activate', () => {
  it('sets status=active and removes revoked_at (rollback path for the last-active-key mitigation)', async () => {
    const client = buildClient(async () => ({}))
    const repository = new DynamoApiKeyRepository(client as any, 'apikey-table', 'prod')

    await repository.activate('k1')

    const command = client.send.mock.calls[0][0]
    expect(command.input.Key).toEqual({ key_id: { S: 'k1' } })
    expect(command.input.UpdateExpression).toContain('REMOVE')
    expect(command.input.ExpressionAttributeValues[':status']).toEqual({ S: 'active' })
  })
})

describe('createApiKeyRepository', () => {
  it('is exported and returns a DynamoApiKeyRepository instance', async () => {
    const { createApiKeyRepository } = await import('@infrastructure/api-key/api-key.dynamo')
    const repository = createApiKeyRepository({ tableName: 'apikey-table', awsStage: 'localstack', awsEndpoint: 'http://localhost:4566' })
    expect(repository).toBeInstanceOf(DynamoApiKeyRepository)
  })
})
