import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { ValidatedSession } from '@titvo/auth'
import { SessionGuardService, UnauthorizedError } from './session-guard.service'
import { jsonResponse } from '../../utils/http-responses'
import { findHeaderCaseInsensitive } from '../../utils/headers'

/**
 * Reusable route-handler wrapper: authenticates the request via
 * `SessionGuardService` before invoking `handler`, converting a rejected
 * session into a clean `401 {error:'unauthorized'}` response instead of a
 * 500/crash. `handler` receives the validated session (including `role`)
 * so future write routes can enforce `role==='admin'` (403 on `member`).
 */
export async function withAuthGuard (
  sessionGuard: SessionGuardService,
  event: APIGatewayProxyEventV2,
  handler: (session: ValidatedSession) => Promise<APIGatewayProxyStructuredResultV2>
): Promise<APIGatewayProxyStructuredResultV2> {
  const cookieHeader = findHeaderCaseInsensitive(event.headers ?? {}, 'cookie')

  let session: ValidatedSession
  try {
    session = await sessionGuard.authenticate(cookieHeader)
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return jsonResponse(401, { error: 'unauthorized' })
    }
    throw error
  }

  return await handler(session)
}
