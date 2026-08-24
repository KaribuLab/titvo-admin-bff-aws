import { describe, expect, it, vi } from 'vitest'
import { APIGatewayProxyEventV2 } from 'aws-lambda'
import { ValidatedSession, ApiKeyNotFoundError } from '@titvo/auth'
import { handleListApiKeys, handleCreateApiKey, handleRevokeApiKey } from '@infrastructure/api-key/api-keys.handler'
import { LastActiveKeyError } from '@app/api-key/api-key.error'

function buildEvent (body?: unknown): APIGatewayProxyEventV2 {
  return { body: body === undefined ? undefined : JSON.stringify(body) } as unknown as APIGatewayProxyEventV2
}

const adminSession: ValidatedSession = { userId: 'u1', email: 'admin@titvo.dev', role: 'admin' }
const memberSession: ValidatedSession = { userId: 'u2', email: 'member@titvo.dev', role: 'member' }

describe('handleListApiKeys', () => {
  it('returns 200 {items:[]} when there are no keys (member-accessible, no role gate — design D8)', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue([]) }

    const result = await handleListApiKeys(useCase as any)

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body as string)).toEqual({ items: [] })
  })

  it('maps items to snake_case wire shape and NEVER includes a raw-looking key/value/api_key field (security)', async () => {
    const useCase = {
      execute: vi.fn().mockResolvedValue([
        { keyId: 'k1', label: 'ci-runner', status: 'active', createdAt: 'a', createdBy: 'admin@titvo.dev', lastUsedAt: undefined, revokedAt: undefined }
      ])
    }

    const result = await handleListApiKeys(useCase as any)
    const parsed = JSON.parse(result.body as string)

    expect(parsed).toEqual({
      items: [{ key_id: 'k1', label: 'ci-runner', status: 'active', created_at: 'a', created_by: 'admin@titvo.dev', last_used_at: undefined, revoked_at: undefined }]
    })
    expect(result.body).not.toContain('"api_key"')
    expect(result.body).not.toContain('"value"')
    expect(result.body).not.toContain('"hash"')
    expect(parsed.items[0]).not.toHaveProperty('api_key')
    expect(parsed.items[0]).not.toHaveProperty('value')
  })
})

describe('handleCreateApiKey', () => {
  it('rejects a member with 403 forbidden and never calls the use-case', async () => {
    const useCase = { execute: vi.fn() }

    const result = await handleCreateApiKey(useCase as any, buildEvent({ label: 'ci-runner' }), memberSession)

    expect(result.statusCode).toBe(403)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'forbidden' })
    expect(useCase.execute).not.toHaveBeenCalled()
  })

  it('returns 400 invalid_request when label is missing', async () => {
    const useCase = { execute: vi.fn() }

    const result = await handleCreateApiKey(useCase as any, buildEvent({}), adminSession)

    expect(result.statusCode).toBe(400)
    expect(useCase.execute).not.toHaveBeenCalled()
  })

  it('allows an admin to create a key, returning 201 with the raw key exactly once in this response', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue({ keyId: 'k1', label: 'ci-runner', apiKey: 'tvok-raw-value' }) }

    const result = await handleCreateApiKey(useCase as any, buildEvent({ label: 'ci-runner' }), adminSession)

    expect(result.statusCode).toBe(201)
    expect(useCase.execute).toHaveBeenCalledWith('ci-runner', 'u1', 'admin@titvo.dev')
    expect(JSON.parse(result.body as string)).toEqual({ key_id: 'k1', label: 'ci-runner', api_key: 'tvok-raw-value' })
  })
})

describe('handleRevokeApiKey', () => {
  it('rejects a member with 403 forbidden and never calls the use-case', async () => {
    const useCase = { execute: vi.fn() }

    const result = await handleRevokeApiKey(useCase as any, 'k1', memberSession)

    expect(result.statusCode).toBe(403)
    expect(useCase.execute).not.toHaveBeenCalled()
  })

  it('returns 200 {key_id, status: revoked} for an admin revoking an active key', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue({ keyId: 'k1', status: 'revoked' }) }

    const result = await handleRevokeApiKey(useCase as any, 'k1', adminSession)

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body as string)).toEqual({ key_id: 'k1', status: 'revoked' })
  })

  it('returns 404 not_found when the key does not exist', async () => {
    const useCase = { execute: vi.fn().mockRejectedValue(new ApiKeyNotFoundError('missing')) }

    const result = await handleRevokeApiKey(useCase as any, 'missing', adminSession)

    expect(result.statusCode).toBe(404)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'not_found' })
  })

  it('returns 409 last_active_key when revoking would leave zero active keys', async () => {
    const useCase = { execute: vi.fn().mockRejectedValue(new LastActiveKeyError('last one')) }

    const result = await handleRevokeApiKey(useCase as any, 'k1', adminSession)

    expect(result.statusCode).toBe(409)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'last_active_key' })
  })

  it('is idempotent: 200 when the use-case returns an already-revoked key without erroring', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue({ keyId: 'k1', status: 'revoked' }) }

    const result = await handleRevokeApiKey(useCase as any, 'k1', adminSession)

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body as string)).toEqual({ key_id: 'k1', status: 'revoked' })
  })
})
