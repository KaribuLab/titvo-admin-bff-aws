import { describe, expect, it, vi } from 'vitest'
import { APIGatewayProxyEventV2 } from 'aws-lambda'
import { SessionGuardService, UnauthorizedError } from '@infrastructure/auth/session-guard.service'
import { withAuthGuard } from '@infrastructure/auth/with-auth-guard'

function buildEvent (headers: Record<string, string>): APIGatewayProxyEventV2 {
  return { headers } as unknown as APIGatewayProxyEventV2
}

describe('withAuthGuard', () => {
  it('returns 401 {error:"unauthorized"} and never calls the inner handler when the cookie is missing', async () => {
    const guard = { authenticate: vi.fn().mockRejectedValue(new UnauthorizedError('missing')) } as unknown as SessionGuardService
    const inner = vi.fn()

    const result = await withAuthGuard(guard, buildEvent({}), inner)

    expect(result.statusCode).toBe(401)
    expect(JSON.parse(result.body as string)).toEqual({ error: 'unauthorized' })
    expect(inner).not.toHaveBeenCalled()
  })

  it('calls the inner handler with the validated session (incl. role) and returns its result on a valid cookie', async () => {
    const session = { userId: 'u1', email: 'a@titvo.dev', role: 'admin' as const }
    const guard = { authenticate: vi.fn().mockResolvedValue(session) } as unknown as SessionGuardService
    const inner = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: JSON.stringify({ ok: true }) })

    const result = await withAuthGuard(guard, buildEvent({ cookie: 'tvo_session=good' }), inner)

    expect(inner).toHaveBeenCalledWith(session)
    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body as string)).toEqual({ ok: true })
  })

  it('finds the cookie header case-insensitively', async () => {
    const session = { userId: 'u2', email: 'm@titvo.dev', role: 'member' as const }
    const guard = { authenticate: vi.fn().mockResolvedValue(session) } as unknown as SessionGuardService
    const inner = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' })

    await withAuthGuard(guard, buildEvent({ Cookie: 'tvo_session=good' }), inner)

    expect(guard.authenticate).toHaveBeenCalledWith('tvo_session=good')
  })
})
