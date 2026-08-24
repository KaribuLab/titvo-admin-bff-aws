import { Injectable, Logger } from '@nestjs/common'
import { SessionExpiredError, SessionInvalidError, ValidateSessionUseCase, ValidatedSession } from '@titvo/auth'
import { extractSessionToken } from '../../utils/cookies'

/**
 * Thrown for every "no valid session" outcome (missing cookie, malformed
 * JWT, expired session, session/token mismatch). Callers should always
 * respond `401 {error:'unauthorized'}` on this error — never leak WHY the
 * session was rejected to the client (design D4/spec admin-auth).
 */
export class UnauthorizedError extends Error {}

/**
 * First line of defense between the internet and the config-write BFF
 * (Phase 3 task 3.4). Wraps titvo-auth's `ValidateSessionUseCase` — the
 * SAME session-validation logic titvo-auth-setup-aws's `/auth/me` uses —
 * so the BFF never reimplements JWT/session verification. Exposes the
 * validated session's `role` so the next batch's write-route guard
 * (member → 403) can consume it without re-deriving it.
 */
@Injectable()
export class SessionGuardService {
  private readonly logger = new Logger(SessionGuardService.name)

  constructor (private readonly validateSessionUseCase: ValidateSessionUseCase) { }

  async authenticate (cookieHeader: string | undefined): Promise<ValidatedSession> {
    const token = extractSessionToken(cookieHeader)

    if (token === undefined) {
      throw new UnauthorizedError('Missing or malformed session cookie')
    }

    try {
      return await this.validateSessionUseCase.execute(token)
    } catch (error) {
      if (error instanceof SessionExpiredError || error instanceof SessionInvalidError) {
        this.logger.warn('Request rejected: session invalid or expired')
        throw new UnauthorizedError('Invalid or expired session')
      }
      throw error
    }
  }
}
