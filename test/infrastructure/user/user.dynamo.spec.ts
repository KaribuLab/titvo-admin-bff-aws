import { describe, it, expect, vi } from 'vitest'
import { DynamoUserRepository } from '../../../src/infrastructure/user/user.dynamo'
import { UserNotFoundError } from '@app/user/user.error'

// Approval tests, ported from titvo-auth-setup-aws's already-proven
// `user.dynamo.spec.ts` (Phase 1 batch 3) — this repo's
// `DynamoUserRepository` is a verbatim port of that same class, so these
// tests characterize/lock in identical behavior here.
function buildClient (sendImpl: (command: any) => Promise<any>) {
  return { send: vi.fn(sendImpl) }
}

describe('DynamoUserRepository.findByEmail', () => {
  it('queries the EmailIndex GSI and maps the item to a UserEntity', async () => {
    const client = buildClient(async () => ({
      Items: [{
        user_id: { S: 'user-1' },
        email: { S: 'admin@titvo.dev' },
        password_hash: { S: 'hashed' },
        role: { S: 'admin' },
        created_at: { S: '2026-01-01T00:00:00.000Z' },
        updated_at: { S: '2026-01-01T00:00:00.000Z' }
      }]
    }))
    const repository = new DynamoUserRepository(client as any, 'user-table')

    const result = await repository.findByEmail('admin@titvo.dev')

    expect(result).toEqual({
      userId: 'user-1',
      email: 'admin@titvo.dev',
      passwordHash: 'hashed',
      role: 'admin',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
  })

  it('returns null when no item matches the email', async () => {
    const client = buildClient(async () => ({ Items: [] }))
    const repository = new DynamoUserRepository(client as any, 'user-table')

    expect(await repository.findByEmail('missing@titvo.dev')).toBeNull()
  })

  it('returns null when the query fails', async () => {
    const client = buildClient(async () => { throw new Error('dynamo unavailable') })
    const repository = new DynamoUserRepository(client as any, 'user-table')

    expect(await repository.findByEmail('admin@titvo.dev')).toBeNull()
  })
})

describe('DynamoUserRepository.findById', () => {
  it('gets the item by user_id and maps it to a UserEntity', async () => {
    const client = buildClient(async () => ({
      Item: {
        user_id: { S: 'user-1' },
        email: { S: 'admin@titvo.dev' },
        password_hash: { S: 'hashed' },
        role: { S: 'member' },
        created_at: { S: '2026-01-01T00:00:00.000Z' },
        updated_at: { S: '2026-01-01T00:00:00.000Z' }
      }
    }))
    const repository = new DynamoUserRepository(client as any, 'user-table')

    const result = await repository.findById('user-1')

    expect(result).toEqual({
      userId: 'user-1',
      email: 'admin@titvo.dev',
      passwordHash: 'hashed',
      role: 'member',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
  })

  it('returns null when the item does not exist', async () => {
    const client = buildClient(async () => ({}))
    const repository = new DynamoUserRepository(client as any, 'user-table')

    expect(await repository.findById('missing-user')).toBeNull()
  })
})

describe('DynamoUserRepository.findAll', () => {
  it('returns an empty array when the table has no items', async () => {
    const client = buildClient(async () => ({}))
    const repository = new DynamoUserRepository(client as any, 'user-table')

    expect(await repository.findAll()).toEqual([])
    expect(client.send.mock.calls[0][0].input.TableName).toBe('user-table')
  })

  it('maps every attribute including legacy items with no status (D7: missing status means active)', async () => {
    const client = buildClient(async () => ({
      Items: [
        {
          user_id: { S: 'u1' },
          email: { S: 'admin@titvo.dev' },
          password_hash: { S: 'hashed' },
          role: { S: 'admin' },
          status: { S: 'active' },
          created_at: { S: 'a' },
          updated_at: { S: 'a' }
        },
        { user_id: { S: 'legacy' }, email: { S: 'legacy@titvo.dev' }, password_hash: { S: 'hashed2' }, role: { S: 'member' }, created_at: { S: 'b' }, updated_at: { S: 'b' } }
      ]
    }))
    const repository = new DynamoUserRepository(client as any, 'user-table')

    const result = await repository.findAll()

    expect(result).toEqual([
      { userId: 'u1', email: 'admin@titvo.dev', passwordHash: 'hashed', role: 'admin', status: 'active', createdAt: 'a', updatedAt: 'a' },
      { userId: 'legacy', email: 'legacy@titvo.dev', passwordHash: 'hashed2', role: 'member', status: undefined, createdAt: 'b', updatedAt: 'b' }
    ])
  })
})

describe('DynamoUserRepository.create', () => {
  it('puts the full item, conditioned on the user not already existing', async () => {
    const client = buildClient(async () => ({}))
    const repository = new DynamoUserRepository(client as any, 'user-table')

    await repository.create({
      userId: 'u1',
      email: 'new@titvo.dev',
      passwordHash: 'bcrypt-hash',
      role: 'member',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })

    const command = client.send.mock.calls[0][0]
    expect(command.input.TableName).toBe('user-table')
    expect(command.input.ConditionExpression).toBe('attribute_not_exists(#user_id)')
    expect(command.input.Item).toEqual({
      user_id: { S: 'u1' },
      email: { S: 'new@titvo.dev' },
      password_hash: { S: 'bcrypt-hash' },
      role: { S: 'member' },
      status: { S: 'active' },
      created_at: { S: '2026-01-01T00:00:00.000Z' },
      updated_at: { S: '2026-01-01T00:00:00.000Z' }
    })
  })
})

describe('DynamoUserRepository.update', () => {
  it('applies a role+status patch and returns the updated entity', async () => {
    const client = buildClient(async () => ({
      Attributes: { user_id: { S: 'u1' }, email: { S: 'a@titvo.dev' }, password_hash: { S: 'h' }, role: { S: 'member' }, status: { S: 'inactive' }, created_at: { S: 'a' }, updated_at: { S: 'b' } }
    }))
    const repository = new DynamoUserRepository(client as any, 'user-table')

    const result = await repository.update('u1', { role: 'member', status: 'inactive' })

    const command = client.send.mock.calls[0][0]
    expect(command.input.Key).toEqual({ user_id: { S: 'u1' } })
    expect(command.input.ConditionExpression).toBe('attribute_exists(#user_id)')
    expect(command.input.ExpressionAttributeValues[':role']).toEqual({ S: 'member' })
    expect(command.input.ExpressionAttributeValues[':status']).toEqual({ S: 'inactive' })
    expect(result.status).toBe('inactive')
    expect(result.role).toBe('member')
  })

  it('applies a status-only patch without touching role', async () => {
    const client = buildClient(async () => ({
      Attributes: { user_id: { S: 'u1' }, email: { S: 'a@titvo.dev' }, password_hash: { S: 'h' }, role: { S: 'admin' }, status: { S: 'inactive' }, created_at: { S: 'a' }, updated_at: { S: 'b' } }
    }))
    const repository = new DynamoUserRepository(client as any, 'user-table')

    await repository.update('u1', { status: 'inactive' })

    const command = client.send.mock.calls[0][0]
    expect(command.input.ExpressionAttributeValues[':role']).toBeUndefined()
    expect(command.input.ExpressionAttributeValues[':status']).toEqual({ S: 'inactive' })
  })

  it('translates a ConditionalCheckFailedException into UserNotFoundError (no phantom item creation)', async () => {
    const conditionalError = Object.assign(new Error('missing'), { name: 'ConditionalCheckFailedException' })
    const client = buildClient(async () => { throw conditionalError })
    const repository = new DynamoUserRepository(client as any, 'user-table')

    await expect(repository.update('missing', { status: 'inactive' })).rejects.toThrow(UserNotFoundError)
  })

  it('propagates an unrelated error unchanged (not masked as not-found)', async () => {
    const client = buildClient(async () => { throw new Error('dynamodb unavailable') })
    const repository = new DynamoUserRepository(client as any, 'user-table')

    await expect(repository.update('u1', { status: 'inactive' })).rejects.toThrow('dynamodb unavailable')
  })
})

describe('createUserRepository', () => {
  it('is exported and returns a DynamoUserRepository instance', async () => {
    const { createUserRepository } = await import('../../../src/infrastructure/user/user.dynamo')
    const repository = createUserRepository({ tableName: 'user-table', awsStage: 'localstack', awsEndpoint: 'http://localhost:4566' })
    expect(repository).toBeInstanceOf(DynamoUserRepository)
  })
})
