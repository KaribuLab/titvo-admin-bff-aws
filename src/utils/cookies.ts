const SESSION_COOKIE_NAME = 'tvo_session'

export interface SessionCookieOptions {
  token: string
  maxAgeSeconds: number
}

/**
 * Builds the `Set-Cookie` header value for the JWT session cookie.
 * httpOnly + Secure + SameSite=Strict per design D4 — the raw token must
 * never be reachable from client-side JS or sent cross-site. Byte-for-byte
 * identical to titvo-auth-setup-aws's `buildSessionCookie` (same JWT
 * format, same cookie attributes) — the BFF is now the browser-facing
 * login path (bff-auth-routing-decision).
 */
export function buildSessionCookie ({ token, maxAgeSeconds }: SessionCookieOptions): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`
}

/**
 * Builds the `Set-Cookie` header value that immediately expires the
 * session cookie (used on logout).
 */
export function buildClearSessionCookie (): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
}

/**
 * Extracts the session token from a raw `Cookie` request header. Returns
 * `undefined` when the header is missing or does not carry the session
 * cookie — callers must treat this as "no session" (design D4, the same
 * `tvo_session` HttpOnly cookie titvo-auth issues on login).
 */
export function extractSessionToken (cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined) {
    return undefined
  }

  const pairs = cookieHeader.split(';').map(pair => pair.trim())
  for (const pair of pairs) {
    const separatorIndex = pair.indexOf('=')
    if (separatorIndex === -1) {
      continue
    }
    const name = pair.slice(0, separatorIndex)
    if (name === SESSION_COOKIE_NAME) {
      return pair.slice(separatorIndex + 1)
    }
  }

  return undefined
}
