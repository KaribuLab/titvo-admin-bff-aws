import { describe, it, expect, vi } from 'vitest'
import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import { handleLogout } from '@infrastructure/auth/logout.handler'

// Ported near-verbatim from titvo-auth-setup-aws's proven
// `logout.handler.spec.ts`, exposed as `POST /api/admin/auth/logout`.
function buildEvent (headers: Record<string, string>): APIGatewayProxyEventV2 {
  return { headers } as unknown as APIGatewayProxyEventV2
}

describe('handleLogout', () => {
  it('always returns 204 and clears the session cookie on a valid token', async () => {
    const logoutUseCase = { execute: vi.fn().mockResolvedValue(undefined) }

    const result = await handleLogout(logoutUseCase as any, buildEvent({ cookie: 'tvo_session=good-token' }))

    expect(result.statusCode).toBe(204)
    expect(result.headers?.['Set-Cookie']).toBe('tvo_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0')
    expect(logoutUseCase.execute).toHaveBeenCalledWith('good-token')
  })

  it('returns 204 and clears the cookie even when no session cookie was present (idempotent)', async () => {
    const logoutUseCase = { execute: vi.fn() }

    const result = await handleLogout(logoutUseCase as any, buildEvent({}))

    expect(result.statusCode).toBe(204)
    expect(logoutUseCase.execute).not.toHaveBeenCalled()
  })

  it('returns 204 and clears the cookie even when the use case throws (never surfaces 401/crashes)', async () => {
    const logoutUseCase = { execute: vi.fn().mockRejectedValue(new Error('dynamodb unavailable')) }

    const result = await handleLogout(logoutUseCase as any, buildEvent({ cookie: 'tvo_session=bad-token' }))

    expect(result.statusCode).toBe(204)
  })
})
