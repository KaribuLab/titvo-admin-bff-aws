import { APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { jsonResponse } from '../../utils/http-responses'

/**
 * `GET /api/admin/health` — unauthenticated liveness check for the BFF
 * Lambda. No session/role checks; used by deploy smoke checks.
 */
export async function handleHealth (): Promise<APIGatewayProxyStructuredResultV2> {
  return jsonResponse(200, { status: 'ok' })
}
