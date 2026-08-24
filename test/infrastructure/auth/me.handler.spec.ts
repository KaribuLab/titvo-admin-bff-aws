import { describe, it, expect } from 'vitest'
import { handleMe } from '@infrastructure/auth/me.handler'
import { ValidatedSession } from '@titvo/auth'

// `GET /api/admin/auth/me` reuses the SAME validated session produced by
// `withAuthGuard`/`SessionGuardService` (Batch 5's guard) — no second
// validation pass, no reimplementation.
describe('handleMe', () => {
  it('returns 200 with the validated session mapped to the wire shape', async () => {
    const session: ValidatedSession = { userId: 'u1', email: 'admin@titvo.dev', role: 'admin' }

    const result = await handleMe(session)

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body as string)).toEqual({ user_id: 'u1', email: 'admin@titvo.dev', role: 'admin' })
  })

  it('reflects a member role unchanged, proving role is not hardcoded', async () => {
    const session: ValidatedSession = { userId: 'u2', email: 'member@titvo.dev', role: 'member' }

    const result = await handleMe(session)

    expect(JSON.parse(result.body as string).role).toBe('member')
  })
})
