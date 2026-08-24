import { describe, expect, it, vi } from 'vitest'
import { APIGatewayProxyEventV2 } from 'aws-lambda'
import { ValidatedSession } from '@titvo/auth'
import {
  handleListConfig,
  handleGetConfig,
  handleAddConfig,
  handleUpdateConfig
} from '@infrastructure/config/config.handler'
import { ConfigAlreadyExistsError, ConfigNotFoundError, ConfigTypeMismatchError, EncryptionUnavailableError } from '@app/config/config.error'

function buildEvent (body?: unknown): APIGatewayProxyEventV2 {
  return { body: body === undefined ? undefined : JSON.stringify(body) } as unknown as APIGatewayProxyEventV2
}

const adminSession: ValidatedSession = { userId: 'u1', email: 'admin@titvo.dev', role: 'admin' }
const memberSession: ValidatedSession = { userId: 'u2', email: 'member@titvo.dev', role: 'member' }

describe('handleListConfig', () => {
  it('returns 200 {items:[]} for an empty table (no error)', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue([]) }

    const result = await handleListConfig(useCase as any)

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body as string)).toEqual({ items: [] })
  })

  it('maps items to snake_case wire shape and never includes value', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue([{ parameterId: 'p1', isSecret: true, updatedAt: 'a', updatedBy: 'admin@titvo.dev' }]) }

    const result = await handleListConfig(useCase as any)

    expect(JSON.parse(result.body as string)).toEqual({
      items: [{ parameter_id: 'p1', is_secret: true, updated_at: 'a', updated_by: 'admin@titvo.dev' }]
    })
    expect(result.body).not.toContain('"value"')
  })

  it('returns 503 encryption_unavailable when secret classification cannot be resolved', async () => {
    const useCase = { execute: vi.fn().mockRejectedValue(new EncryptionUnavailableError('down')) }

    const result = await handleListConfig(useCase as any)

    expect(result.statusCode).toBe(503)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'encryption_unavailable' })
  })
})

describe('handleGetConfig', () => {
  it('returns 404 when the entry does not exist', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue(null) }

    const result = await handleGetConfig(useCase as any, 'missing')

    expect(result.statusCode).toBe(404)
  })

  it('returns the detail with snake_case fields, value only when present', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue({ parameterId: 'p1', isSecret: false, value: 'hello', updatedAt: 'a', updatedBy: 'b' }) }

    const result = await handleGetConfig(useCase as any, 'p1')

    expect(JSON.parse(result.body as string)).toEqual({ parameter_id: 'p1', is_secret: false, value: 'hello', updated_at: 'a', updated_by: 'b' })
  })
})

describe('handleAddConfig', () => {
  it('rejects a member with 403 forbidden and never calls the use-case', async () => {
    const useCase = { execute: vi.fn() }

    const result = await handleAddConfig(useCase as any, buildEvent({ parameter_id: 'p1', value: 'x', is_secret: false }), memberSession)

    expect(result.statusCode).toBe(403)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'forbidden' })
    expect(useCase.execute).not.toHaveBeenCalled()
  })

  it('allows an admin to add a new entry, returning 201', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue(undefined) }

    const result = await handleAddConfig(useCase as any, buildEvent({ parameter_id: 'p1', value: 'x', is_secret: false }), adminSession)

    expect(result.statusCode).toBe(201)
    expect(useCase.execute).toHaveBeenCalledWith({ parameterId: 'p1', value: 'x', isSecret: false }, 'admin@titvo.dev')
  })

  it('returns 400 invalid_request when required fields are missing', async () => {
    const useCase = { execute: vi.fn() }

    const result = await handleAddConfig(useCase as any, buildEvent({ parameter_id: 'p1' }), adminSession)

    expect(result.statusCode).toBe(400)
    expect(useCase.execute).not.toHaveBeenCalled()
  })

  it('returns 409 already_exists on a duplicate key ("this key already exists")', async () => {
    const useCase = { execute: vi.fn().mockRejectedValue(new ConfigAlreadyExistsError('dup')) }

    const result = await handleAddConfig(useCase as any, buildEvent({ parameter_id: 'p1', value: 'x', is_secret: false }), adminSession)

    expect(result.statusCode).toBe(409)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'already_exists' })
  })

  it('returns 503 encryption_unavailable when the AES key/Secrets Manager is unreachable', async () => {
    const useCase = { execute: vi.fn().mockRejectedValue(new EncryptionUnavailableError('down')) }

    const result = await handleAddConfig(useCase as any, buildEvent({ parameter_id: 'p1', value: 'x', is_secret: true }), adminSession)

    expect(result.statusCode).toBe(503)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'encryption_unavailable' })
  })
})

describe('handleUpdateConfig', () => {
  it('rejects a member with 403 forbidden and never calls the use-case', async () => {
    const useCase = { execute: vi.fn() }

    const result = await handleUpdateConfig(useCase as any, buildEvent({ value: 'x' }), 'p1', memberSession)

    expect(result.statusCode).toBe(403)
    expect(useCase.execute).not.toHaveBeenCalled()
  })

  it('allows an admin to update, returning 200', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue(undefined) }

    const result = await handleUpdateConfig(useCase as any, buildEvent({ value: 'new' }), 'p1', adminSession)

    expect(result.statusCode).toBe(200)
    expect(useCase.execute).toHaveBeenCalledWith('p1', { value: 'new', isSecret: undefined }, 'admin@titvo.dev')
  })

  it('returns 404 not_found when the key does not exist', async () => {
    const useCase = { execute: vi.fn().mockRejectedValue(new ConfigNotFoundError('missing')) }

    const result = await handleUpdateConfig(useCase as any, buildEvent({ value: 'x' }), 'missing', adminSession)

    expect(result.statusCode).toBe(404)
  })

  it('returns 409 type_mismatch when is_secret flips on an existing key', async () => {
    const useCase = { execute: vi.fn().mockRejectedValue(new ConfigTypeMismatchError('flip')) }

    const result = await handleUpdateConfig(useCase as any, buildEvent({ is_secret: true }), 'p1', adminSession)

    expect(result.statusCode).toBe(409)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'type_mismatch' })
  })
})
