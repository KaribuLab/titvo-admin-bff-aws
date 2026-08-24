import { Logger } from '@nestjs/common'
import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { LoginUseCase, InvalidCredentialsError, SESSION_TTL_SECONDS } from '@titvo/auth'
import { jsonResponse } from '../../utils/http-responses'
import { buildSessionCookie } from '../../utils/cookies'

const logger = new Logger('LoginHandler')

interface LoginRequestBody {
  email?: string
  password?: string
}

/**
 * Handles `POST /api/admin/auth/login`. Ported near-verbatim from
 * titvo-auth-setup-aws's `login.handler.ts` — same `LoginUseCase`, same
 * cookie mechanism (httpOnly/Secure/SameSite=Strict) — since the BFF is
 * now the browser-facing login path (bff-auth-routing-decision). The raw
 * token is never present in the JSON body.
 */
export async function handleLogin (loginUseCase: LoginUseCase, event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const body = JSON.parse(event.body ?? '{}') as LoginRequestBody

  if (body.email === undefined || body.password === undefined) {
    return jsonResponse(400, { error: 'invalid_request' })
  }

  try {
    const result = await loginUseCase.execute(body.email, body.password)
    return jsonResponse(
      200,
      { user_id: result.user.userId, email: result.user.email, role: result.user.role },
      { 'Set-Cookie': buildSessionCookie({ token: result.token, maxAgeSeconds: SESSION_TTL_SECONDS }) }
    )
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      return jsonResponse(401, { error: 'invalid_credentials' })
    }
    logger.error(`Error caught in handler: ${error instanceof Error ? error.message : String(error)}`)
    return jsonResponse(500, { error: 'internal_error' })
  }
}
