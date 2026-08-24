import { describe, it, expect, vi } from 'vitest'
import { DynamoSessionRepository } from '../../../src/infrastructure/session/session.dynamo'

// Approval tests, ported from titvo-auth-setup-aws's already-proven
// `session.dynamo.spec.ts` (Phase 1 batch 3) — this repo's
// `DynamoSessionRepository` is a verbatim port of that same class, so
// these tests characterize/lock in identical behavior here.
function buildClient (sendImpl: (command: any) => Promise<any>) {
  return { send: vi.fn(sendImpl) }
}

describe('DynamoSessionRepository.create', () => {
  it('puts a new session item with the session fields', async () => {
    const client = buildClient(async () => ({}))
    const repository = new DynamoSessionRepository(client as any, 'session-table')

    await repository.create({
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'admin',
      ttl: 1234567890,
      createdAt: '2026-01-01T00:00:00.000Z'
    })

    expect(client.send).toHaveBeenCalledTimes(1)
    const command = client.send.mock.calls[0][0]
    expect(command.input.TableName).toBe('session-table')
    expect(command.input.Item).toEqual({
      session_id: { S: 'session-1' },
      user_id: { S: 'user-1' },
      role: { S: 'admin' },
      ttl: { N: '1234567890' },
      created_at: { S: '2026-01-01T00:00:00.000Z' }
    })
  })
})

describe('DynamoSessionRepository.findById', () => {
  it('gets the item by session_id and maps it to a SessionEntity', async () => {
    const client = buildClient(async () => ({
      Item: {
        session_id: { S: 'session-1' },
        user_id: { S: 'user-1' },
        role: { S: 'admin' },
        ttl: { N: '1234567890' },
        created_at: { S: '2026-01-01T00:00:00.000Z' }
      }
    }))
    const repository = new DynamoSessionRepository(client as any, 'session-table')

    const result = await repository.findById('session-1')

    expect(result).toEqual({
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'admin',
      ttl: 1234567890,
      createdAt: '2026-01-01T00:00:00.000Z'
    })
  })

  it('returns null when the session does not exist', async () => {
    const client = buildClient(async () => ({}))
    const repository = new DynamoSessionRepository(client as any, 'session-table')

    expect(await repository.findById('missing-session')).toBeNull()
  })
})

describe('DynamoSessionRepository.deleteById', () => {
  it('deletes the item by session_id', async () => {
    const client = buildClient(async () => ({}))
    const repository = new DynamoSessionRepository(client as any, 'session-table')

    await repository.deleteById('session-1')

    expect(client.send).toHaveBeenCalledTimes(1)
    const command = client.send.mock.calls[0][0]
    expect(command.input.TableName).toBe('session-table')
    expect(command.input.Key).toEqual({ session_id: { S: 'session-1' } })
  })
})

describe('DynamoSessionRepository.refreshTtl', () => {
  it('updates the ttl attribute for the given session', async () => {
    const client = buildClient(async () => ({}))
    const repository = new DynamoSessionRepository(client as any, 'session-table')

    await repository.refreshTtl('session-1', 987654321)

    expect(client.send).toHaveBeenCalledTimes(1)
    const command = client.send.mock.calls[0][0]
    expect(command.input.TableName).toBe('session-table')
    expect(command.input.Key).toEqual({ session_id: { S: 'session-1' } })
    expect(command.input.ExpressionAttributeValues).toEqual({ ':ttl': { N: '987654321' } })
  })
})
