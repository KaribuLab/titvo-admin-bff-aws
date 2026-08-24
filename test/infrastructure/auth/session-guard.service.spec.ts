import { describe, expect, it, vi } from 'vitest'
import { SessionExpiredError, SessionInvalidError, ValidateSessionUseCase } from '@titvo/auth'
import { SessionGuardService, UnauthorizedError } from '@infrastructure/auth/session-guard.service'

function buildUseCase (execute: (token: string) => Promise<any>): ValidateSessionUseCase {
  return { execute } as unknown as ValidateSessionUseCase
}

describe('SessionGuardService', () => {
  it('rejects a missing cookie header with UnauthorizedError, without calling the use-case', async () => {
    const execute = vi.fn()
    const guard = new SessionGuardService(buildUseCase(execute))

    await expect(guard.authenticate(undefined)).rejects.toThrow(UnauthorizedError)
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects a cookie header without the tvo_session cookie, without calling the use-case', async () => {
    const execute = vi.fn()
    const guard = new SessionGuardService(buildUseCase(execute))

    await expect(guard.authenticate('other_cookie=abc')).rejects.toThrow(UnauthorizedError)
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects an expired session as UnauthorizedError', async () => {
    const execute = vi.fn().mockRejectedValue(new SessionExpiredError('expired'))
    const guard = new SessionGuardService(buildUseCase(execute))

    await expect(guard.authenticate('tvo_session=expired-token')).rejects.toThrow(UnauthorizedError)
    expect(execute).toHaveBeenCalledWith('expired-token')
  })

  it('rejects a session that fails claim/row matching as UnauthorizedError', async () => {
    const execute = vi.fn().mockRejectedValue(new SessionInvalidError('mismatch'))
    const guard = new SessionGuardService(buildUseCase(execute))

    await expect(guard.authenticate('tvo_session=bad-token')).rejects.toThrow(UnauthorizedError)
  })

  it('returns the validated session — including role — for a valid cookie', async () => {
    const execute = vi.fn().mockResolvedValue({ userId: 'u1', email: 'admin@titvo.dev', role: 'admin' })
    const guard = new SessionGuardService(buildUseCase(execute))

    const session = await guard.authenticate('tvo_session=good-token')

    expect(session).toEqual({ userId: 'u1', email: 'admin@titvo.dev', role: 'admin' })
    expect(execute).toHaveBeenCalledWith('good-token')
  })

  it('returns a member-role session unchanged, proving role is not hardcoded', async () => {
    const execute = vi.fn().mockResolvedValue({ userId: 'u2', email: 'member@titvo.dev', role: 'member' })
    const guard = new SessionGuardService(buildUseCase(execute))

    const session = await guard.authenticate('tvo_session=member-token')

    expect(session.role).toBe('member')
  })

  it('propagates an unexpected error from the use-case unchanged (not masked as Unauthorized)', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('dynamodb unavailable'))
    const guard = new SessionGuardService(buildUseCase(execute))

    await expect(guard.authenticate('tvo_session=x')).rejects.toThrow('dynamodb unavailable')
  })
})
