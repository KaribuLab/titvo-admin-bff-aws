import { APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { ValidatedSession } from '@titvo/auth'
import { jsonResponse } from '../../utils/http-responses'

/**
 * Handles `GET /api/admin/auth/me`. Unlike titvo-auth-setup-aws's
 * `me.handler.ts` (which validates the cookie itself), this route is
 * dispatched through `withAuthGuard`/`SessionGuardService` (task 3.4) —
 * the SAME session-validation logic — so by the time this handler runs
 * the session is already validated. No second validation pass, no
 * reimplementation; this just maps the already-validated session to the
 * wire shape.
 */
export async function handleMe (session: ValidatedSession): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(200, { user_id: session.userId, email: session.email, role: session.role })
}
