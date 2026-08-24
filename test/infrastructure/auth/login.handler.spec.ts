import { describe, it, expect, vi } from 'vitest'
import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import { InvalidCredentialsError } from '@titvo/auth'
import { handleLogin } from '@infrastructure/auth/login.handler'

// Ported near-verbatim from titvo-auth-setup-aws's proven
// `login.handler.spec.ts` (Phase 1 batch 3) — same use-case contract,
// same cookie mechanism. The BFF is now the browser-facing login path
// (bff-auth-routing-decision): it calls titvo-auth's `LoginUseCase`
// directly, exposed as `POST /api/admin/auth/login`.
function buildEvent (body: unknown): APIGatewayProxyEventV2 {
  return { body: JSON.stringify(body) } as unknown as APIGatewayProxyEventV2
}

describe('handleLogin', () => {
  it('returns 200, the user info (no token in body), and a Set-Cookie header on success', async () => {
    const loginUseCase = {
      execute: vi.fn().mockResolvedValue({
        token: 'signed-jwt',
        user: { userId: 'user-1', email: 'admin@titvo.dev', role: 'admin' }
      })
    }

    const result = await handleLogin(loginUseCase as any, buildEvent({ email: 'admin@titvo.dev', password: 'secret' }))

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body as string)).toEqual({
      user_id: 'user-1',
      email: 'admin@titvo.dev',
      role: 'admin'
    })
    expect(result.body).not.toContain('signed-jwt')
    expect(result.headers?.['Set-Cookie']).toBe(
      'tvo_session=signed-jwt; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600'
    )
    expect(loginUseCase.execute).toHaveBeenCalledWith('admin@titvo.dev', 'secret')
  })

  it('returns 401 {error:"invalid_credentials"} when the use case rejects invalid credentials', async () => {
    const loginUseCase = { execute: vi.fn().mockRejectedValue(new InvalidCredentialsError('Invalid email or password')) }

    const result = await handleLogin(loginUseCase as any, buildEvent({ email: 'unknown@titvo.dev', password: 'wrong' }))

    expect(result.statusCode).toBe(401)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'invalid_credentials' })
    expect(result.headers?.['Set-Cookie']).toBeUndefined()
  })

  it('returns 400 when the request body is missing email/password', async () => {
    const loginUseCase = { execute: vi.fn() }

    const result = await handleLogin(loginUseCase as any, buildEvent({ email: 'admin@titvo.dev' }))

    expect(result.statusCode).toBe(400)
    expect(loginUseCase.execute).not.toHaveBeenCalled()
  })

  it('returns 500 on an unexpected error without crashing', async () => {
    const loginUseCase = { execute: vi.fn().mockRejectedValue(new Error('dynamo unavailable')) }

    const result = await handleLogin(loginUseCase as any, buildEvent({ email: 'admin@titvo.dev', password: 'secret' }))

    expect(result.statusCode).toBe(500)
  })
})
