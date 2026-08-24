import { describe, expect, it } from 'vitest'
import { extractSessionToken, buildSessionCookie, buildClearSessionCookie } from '../../src/utils/cookies'

// Approval test: `cookies.ts` was ported verbatim from
// titvo-auth-setup-aws's already-proven `extractSessionToken` — see
// apply-progress Deviations. These tests characterize/lock in its
// behavior in this repo.
describe('extractSessionToken', () => {
  it('extracts the tvo_session value from a single-cookie header', () => {
    expect(extractSessionToken('tvo_session=abc123')).toBe('abc123')
  })

  it('extracts tvo_session when mixed with other cookies', () => {
    expect(extractSessionToken('foo=bar; tvo_session=abc123; other=xyz')).toBe('abc123')
  })

  it('returns undefined when the header is undefined', () => {
    expect(extractSessionToken(undefined)).toBeUndefined()
  })

  it('returns undefined when tvo_session is not present', () => {
    expect(extractSessionToken('foo=bar; other=xyz')).toBeUndefined()
  })
})

// New for the auth-proxy routes (bff-auth-routing-decision): the BFF now
// sets/clears the session cookie itself, using the SAME
// httpOnly/Secure/SameSite=Strict mechanism titvo-auth-setup-aws's
// login/logout handlers already use — verified byte-for-byte against
// that repo's own `buildSessionCookie`/`buildClearSessionCookie`.
describe('buildSessionCookie', () => {
  it('builds an httpOnly/Secure/SameSite=Strict Set-Cookie header with the given token and max-age', () => {
    expect(buildSessionCookie({ token: 'signed-jwt', maxAgeSeconds: 3600 })).toBe(
      'tvo_session=signed-jwt; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600'
    )
  })
})

describe('buildClearSessionCookie', () => {
  it('builds a Set-Cookie header that immediately expires the session cookie', () => {
    expect(buildClearSessionCookie()).toBe('tvo_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0')
  })
})
