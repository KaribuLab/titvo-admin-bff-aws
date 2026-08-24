import { Logger } from '@nestjs/common'
import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { LogoutUseCase } from '@titvo/auth'
import { buildClearSessionCookie, extractSessionToken } from '../../utils/cookies'
import { findHeaderCaseInsensitive } from '../../utils/headers'

const logger = new Logger('LogoutHandler')

/**
 * Handles `POST /api/admin/auth/logout`. Ported near-verbatim from
 * titvo-auth-setup-aws's `logout.handler.ts` — always returns 204 and
 * clears the session cookie, even with a missing/invalid cookie or an
 * unexpected repository failure (idempotent, never surfaces 401/crashes).
 */
export async function handleLogout (logoutUseCase: LogoutUseCase, event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const cookieHeader = findHeaderCaseInsensitive(event.headers ?? {}, 'cookie')
  const token = extractSessionToken(cookieHeader)

  if (token !== undefined) {
    try {
      await logoutUseCase.execute(token)
    } catch (error) {
      logger.warn(`Logout use case failed, clearing cookie anyway: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    statusCode: 204,
    headers: { 'Set-Cookie': buildClearSessionCookie() }
  }
}
