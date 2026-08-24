import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { ApiKeyEntity, ApiKeyNotFoundError, ValidatedSession } from '@titvo/auth'
import { ListApiKeysUseCase, ApiKeyListItem } from '@app/api-key/list-api-keys.use-case'
import { CreateApiKeyUseCase, CreatedApiKey } from '@app/api-key/create-api-key.use-case'
import { RevokeApiKeyUseCase } from '@app/api-key/revoke-api-key.use-case'
import { LastActiveKeyError } from '@app/api-key/api-key.error'
import { jsonResponse } from '../../utils/http-responses'

interface CreateApiKeyRequestBody {
  label?: string
}

function toListWireShape (item: ApiKeyListItem): Record<string, unknown> {
  return {
    key_id: item.keyId,
    label: item.label,
    status: item.status,
    created_at: item.createdAt,
    created_by: item.createdBy,
    last_used_at: item.lastUsedAt,
    revoked_at: item.revokedAt
  }
}

/**
 * `GET /api/admin/api-keys` — session-guarded, NO role check (design D8:
 * `member` may list, only `admin` may create/revoke). `toListWireShape`
 * only reads fields off `ApiKeyListItem`, a type with no `apiKey`/hash
 * field at all — the raw/hashed key can never leak through this
 * response, at either the use-case or the wire-mapping layer.
 */
export async function handleListApiKeys (listApiKeysUseCase: ListApiKeysUseCase): Promise<APIGatewayProxyStructuredResultV2> {
  const items = await listApiKeysUseCase.execute()
  return jsonResponse(200, { items: items.map(toListWireShape) })
}

/**
 * `POST /api/admin/api-keys` — writes require `role === 'admin'`. The
 * response body is the ONLY place in the entire system that ever carries
 * raw key material (design D4/D8) — it is never logged and never
 * returned again by any other endpoint.
 */
export async function handleCreateApiKey (
  createApiKeyUseCase: CreateApiKeyUseCase,
  event: APIGatewayProxyEventV2,
  session: ValidatedSession
): Promise<APIGatewayProxyStructuredResultV2> {
  if (session.role !== 'admin') {
    return jsonResponse(403, { error: 'forbidden' })
  }

  const body = JSON.parse(event.body ?? '{}') as CreateApiKeyRequestBody
  if (body.label === undefined || body.label.trim().length === 0) {
    return jsonResponse(400, { error: 'invalid_request' })
  }

  const created: CreatedApiKey = await createApiKeyUseCase.execute(body.label, session.userId, session.email)
  return jsonResponse(201, { key_id: created.keyId, label: created.label, api_key: created.apiKey })
}

/**
 * `POST /api/admin/api-keys/:id/revoke` — writes require `role ===
 * 'admin'`. `409 last_active_key` on the last-active-key invariant
 * (design risk resolution #1); `404 not_found` for an unknown key;
 * already-revoked is idempotent `200` (the use-case returns the
 * unchanged entity without erroring).
 */
export async function handleRevokeApiKey (
  revokeApiKeyUseCase: RevokeApiKeyUseCase,
  keyId: string,
  session: ValidatedSession
): Promise<APIGatewayProxyStructuredResultV2> {
  if (session.role !== 'admin') {
    return jsonResponse(403, { error: 'forbidden' })
  }

  try {
    const revoked: ApiKeyEntity = await revokeApiKeyUseCase.execute(keyId)
    return jsonResponse(200, { key_id: revoked.keyId, status: revoked.status })
  } catch (error) {
    if (error instanceof ApiKeyNotFoundError) {
      return jsonResponse(404, { error: 'not_found' })
    }
    if (error instanceof LastActiveKeyError) {
      return jsonResponse(409, { error: 'last_active_key' })
    }
    throw error
  }
}
