import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { ValidatedSession } from '@titvo/auth'
import { ListConfigUseCase } from '@app/config/list-config.use-case'
import { GetConfigUseCase } from '@app/config/get-config.use-case'
import { AddConfigUseCase } from '@app/config/add-config.use-case'
import { UpdateConfigUseCase } from '@app/config/update-config.use-case'
import { ConfigAlreadyExistsError, ConfigNotFoundError, ConfigTypeMismatchError, EncryptionUnavailableError } from '@app/config/config.error'
import { ConfigDetail, ConfigListItem } from '@core/config/config.entity'
import { jsonResponse } from '../../utils/http-responses'

interface AddConfigRequestBody {
  parameter_id?: string
  value?: string
  is_secret?: boolean
}

interface UpdateConfigRequestBody {
  value?: string
  is_secret?: boolean
}

function toListWireShape (item: ConfigListItem): Record<string, unknown> {
  return { parameter_id: item.parameterId, is_secret: item.isSecret, updated_at: item.updatedAt, updated_by: item.updatedBy }
}

function toDetailWireShape (item: ConfigDetail): Record<string, unknown> {
  return { parameter_id: item.parameterId, is_secret: item.isSecret, value: item.value, updated_at: item.updatedAt, updated_by: item.updatedBy }
}

/** `GET /api/admin/config` — spec: empty table renders `{items:[]}`, never an error; entries never include `value`. */
export async function handleListConfig (listConfigUseCase: ListConfigUseCase): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const items = await listConfigUseCase.execute()
    return jsonResponse(200, { items: items.map(toListWireShape) })
  } catch (error) {
    if (error instanceof EncryptionUnavailableError) {
      return jsonResponse(503, { error: 'encryption_unavailable' })
    }
    throw error
  }
}

/** `GET /api/admin/config/:id` — `value` present only when `is_secret === false`. */
export async function handleGetConfig (getConfigUseCase: GetConfigUseCase, parameterId: string): Promise<APIGatewayProxyStructuredResultV2> {
  try {
    const item = await getConfigUseCase.execute(parameterId)
    if (item === null) {
      return jsonResponse(404, { error: 'not_found' })
    }
    return jsonResponse(200, toDetailWireShape(item))
  } catch (error) {
    if (error instanceof EncryptionUnavailableError) {
      return jsonResponse(503, { error: 'encryption_unavailable' })
    }
    throw error
  }
}

/**
 * `POST /api/admin/config` — writes require `role === 'admin'` (spec:
 * "Admin-Only Write Access"). Duplicate keys are rejected (no silent
 * clobber); AES/Secrets Manager outage fails loudly with 503, never
 * persisting plaintext under a secret path.
 */
export async function handleAddConfig (
  addConfigUseCase: AddConfigUseCase,
  event: APIGatewayProxyEventV2,
  session: ValidatedSession
): Promise<APIGatewayProxyStructuredResultV2> {
  if (session.role !== 'admin') {
    return jsonResponse(403, { error: 'forbidden' })
  }

  const body = JSON.parse(event.body ?? '{}') as AddConfigRequestBody
  if (body.parameter_id === undefined || body.value === undefined || body.is_secret === undefined) {
    return jsonResponse(400, { error: 'invalid_request' })
  }

  try {
    await addConfigUseCase.execute({ parameterId: body.parameter_id, value: body.value, isSecret: body.is_secret }, session.email)
    return jsonResponse(201, { parameter_id: body.parameter_id })
  } catch (error) {
    if (error instanceof ConfigAlreadyExistsError) {
      return jsonResponse(409, { error: 'already_exists' })
    }
    if (error instanceof EncryptionUnavailableError) {
      return jsonResponse(503, { error: 'encryption_unavailable' })
    }
    throw error
  }
}

/**
 * `PUT /api/admin/config/:id` — writes require `role === 'admin'`.
 * Omitted `value` leaves the stored value untouched (last-write-wins,
 * design D4). Flipping `is_secret` on an existing key is rejected (409).
 */
export async function handleUpdateConfig (
  updateConfigUseCase: UpdateConfigUseCase,
  event: APIGatewayProxyEventV2,
  parameterId: string,
  session: ValidatedSession
): Promise<APIGatewayProxyStructuredResultV2> {
  if (session.role !== 'admin') {
    return jsonResponse(403, { error: 'forbidden' })
  }

  const body = JSON.parse(event.body ?? '{}') as UpdateConfigRequestBody

  try {
    await updateConfigUseCase.execute(parameterId, { value: body.value, isSecret: body.is_secret }, session.email)
    return jsonResponse(200, { parameter_id: parameterId })
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      return jsonResponse(404, { error: 'not_found' })
    }
    if (error instanceof ConfigTypeMismatchError) {
      return jsonResponse(409, { error: 'type_mismatch' })
    }
    if (error instanceof EncryptionUnavailableError) {
      return jsonResponse(503, { error: 'encryption_unavailable' })
    }
    throw error
  }
}
