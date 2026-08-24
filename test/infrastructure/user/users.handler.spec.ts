import { describe, expect, it, vi } from 'vitest'
import { APIGatewayProxyEventV2 } from 'aws-lambda'
import { ValidatedSession, UserAlreadyExistsError, LastAdminError } from '@titvo/auth'
import { handleListUsers, handleCreateUser, handleUpdateUser } from '@infrastructure/user/users.handler'
import { UserNotFoundError } from '@app/user/user.error'

function buildEvent (body?: unknown): APIGatewayProxyEventV2 {
  return { body: body === undefined ? undefined : JSON.stringify(body) } as unknown as APIGatewayProxyEventV2
}

const adminSession: ValidatedSession = { userId: 'u1', email: 'admin@titvo.dev', role: 'admin' }
const memberSession: ValidatedSession = { userId: 'u2', email: 'member@titvo.dev', role: 'member' }

describe('handleListUsers', () => {
  it('returns 200 {items:[]} when only the seed admin does not exist yet (member-accessible, no role gate)', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue([]) }

    const result = await handleListUsers(useCase as any)

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body as string)).toEqual({ items: [] })
  })

  it('maps items to snake_case wire shape and NEVER includes password_hash/passwordHash (security)', async () => {
    const useCase = {
      execute: vi.fn().mockResolvedValue([
        { userId: 'u1', email: 'admin@titvo.dev', role: 'admin', status: 'active', createdAt: 'a', updatedAt: 'a' }
      ])
    }

    const result = await handleListUsers(useCase as any)
    const parsed = JSON.parse(result.body as string)

    expect(parsed).toEqual({
      items: [{ user_id: 'u1', email: 'admin@titvo.dev', role: 'admin', status: 'active', created_at: 'a', updated_at: 'a' }]
    })
    expect(result.body).not.toContain('password')
    expect(parsed.items[0]).not.toHaveProperty('password_hash')
  })
})

describe('handleCreateUser', () => {
  it('rejects a member with 403 forbidden and never calls the use-case', async () => {
    const useCase = { execute: vi.fn() }

    const result = await handleCreateUser(useCase as any, buildEvent({ email: 'new@titvo.dev', password: 'longenough', role: 'member' }), memberSession)

    expect(result.statusCode).toBe(403)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'forbidden' })
    expect(useCase.execute).not.toHaveBeenCalled()
  })

  it('returns 400 invalid_request when email/password/role is missing', async () => {
    const useCase = { execute: vi.fn() }

    const result = await handleCreateUser(useCase as any, buildEvent({ email: 'new@titvo.dev' }), adminSession)

    expect(result.statusCode).toBe(400)
    expect(useCase.execute).not.toHaveBeenCalled()
  })

  it('returns 400 invalid_request when the password is too short (weak password)', async () => {
    const useCase = { execute: vi.fn() }

    const result = await handleCreateUser(useCase as any, buildEvent({ email: 'new@titvo.dev', password: 'short', role: 'member' }), adminSession)

    expect(result.statusCode).toBe(400)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'invalid_request' })
    expect(useCase.execute).not.toHaveBeenCalled()
  })

  it('returns 400 invalid_request when role is neither admin nor member', async () => {
    const useCase = { execute: vi.fn() }

    const result = await handleCreateUser(useCase as any, buildEvent({ email: 'new@titvo.dev', password: 'longenough', role: 'superuser' }), adminSession)

    expect(result.statusCode).toBe(400)
    expect(useCase.execute).not.toHaveBeenCalled()
  })

  it('allows an admin to create a user, returning 201 with user_id/email/role and NEVER the password', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue({ userId: 'u3', email: 'new@titvo.dev', role: 'member' }) }

    const result = await handleCreateUser(useCase as any, buildEvent({ email: 'new@titvo.dev', password: 'longenough', role: 'member' }), adminSession)

    expect(result.statusCode).toBe(201)
    expect(useCase.execute).toHaveBeenCalledWith('new@titvo.dev', 'longenough', 'member')
    expect(JSON.parse(result.body as string)).toEqual({ user_id: 'u3', email: 'new@titvo.dev', role: 'member' })
    expect(result.body).not.toContain('longenough')
    expect(result.body).not.toContain('password')
  })

  it('returns 409 already_exists on email collision', async () => {
    const useCase = { execute: vi.fn().mockRejectedValue(new UserAlreadyExistsError('exists')) }

    const result = await handleCreateUser(useCase as any, buildEvent({ email: 'admin@titvo.dev', password: 'longenough', role: 'member' }), adminSession)

    expect(result.statusCode).toBe(409)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'already_exists' })
  })
})

describe('handleUpdateUser', () => {
  it('rejects a member with 403 forbidden and never calls the use-case', async () => {
    const useCase = { execute: vi.fn() }

    const result = await handleUpdateUser(useCase as any, buildEvent({ status: 'inactive' }), 'u1', memberSession)

    expect(result.statusCode).toBe(403)
    expect(useCase.execute).not.toHaveBeenCalled()
  })

  it('returns 200 with the updated user metadata for an admin deactivating a non-last-admin user', async () => {
    const useCase = { execute: vi.fn().mockResolvedValue({ userId: 'u2', email: 'member@titvo.dev', role: 'member', status: 'inactive' }) }

    const result = await handleUpdateUser(useCase as any, buildEvent({ status: 'inactive' }), 'u2', adminSession)

    expect(result.statusCode).toBe(200)
    expect(useCase.execute).toHaveBeenCalledWith('u2', { role: undefined, status: 'inactive' })
    expect(JSON.parse(result.body as string)).toEqual({ user_id: 'u2', email: 'member@titvo.dev', role: 'member', status: 'inactive' })
  })

  it('returns 409 last_admin when deactivating/de-admin-ing the last active admin', async () => {
    const useCase = { execute: vi.fn().mockRejectedValue(new LastAdminError('last one')) }

    const result = await handleUpdateUser(useCase as any, buildEvent({ status: 'inactive' }), 'u1', adminSession)

    expect(result.statusCode).toBe(409)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'last_admin' })
  })

  it('returns 404 not_found when the target user does not exist', async () => {
    const useCase = { execute: vi.fn().mockRejectedValue(new UserNotFoundError('missing')) }

    const result = await handleUpdateUser(useCase as any, buildEvent({ role: 'admin' }), 'missing', adminSession)

    expect(result.statusCode).toBe(404)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'not_found' })
  })
})
