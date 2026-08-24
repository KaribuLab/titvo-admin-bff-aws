import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { UserEntity, UserRole, UserStatus, ValidatedSession, UserAlreadyExistsError, LastAdminError, CreateUserUseCase } from '@titvo/auth'
import { ListUsersUseCase, UserListItem } from '@app/user/list-users.use-case'
import { UpdateUserUseCase } from '@app/user/update-user.use-case'
import { UserNotFoundError } from '@app/user/user.error'
import { jsonResponse } from '../../utils/http-responses'

/** Spec: "400 invalid_request on weak/short password" — no email/SMTP flow, so this is the only strength gate. */
const MIN_PASSWORD_LENGTH = 8

interface CreateUserRequestBody {
  email?: string
  password?: string
  role?: string
}

interface UpdateUserRequestBody {
  role?: string
  status?: string
}

function toListWireShape (item: UserListItem): Record<string, unknown> {
  return {
    user_id: item.userId,
    email: item.email,
    role: item.role,
    status: item.status,
    created_at: item.createdAt,
    updated_at: item.updatedAt
  }
}

function isValidRole (role: string | undefined): role is UserRole {
  return role === 'admin' || role === 'member'
}

function isValidStatus (status: string | undefined): status is UserStatus | undefined {
  return status === undefined || status === 'active' || status === 'inactive'
}

/**
 * `GET /api/admin/users` — session-guarded, NO role check (spec: "List
 * Users" is readable by `admin` and `member`). `toListWireShape` only
 * reads fields off `UserListItem`, a type with no `passwordHash` field at
 * all — the hash can never leak through this response.
 */
export async function handleListUsers (listUsersUseCase: ListUsersUseCase): Promise<APIGatewayProxyStructuredResultV2> {
  const items = await listUsersUseCase.execute()
  return jsonResponse(200, { items: items.map(toListWireShape) })
}

/**
 * `POST /api/admin/users` — writes require `role === 'admin'`
 * (admin-set-password invite, design decision #3 — no email/SMTP). The
 * chosen password is used only to derive the bcrypt hash inside
 * `CreateUserUseCase` and is never logged, persisted, or echoed back.
 */
export async function handleCreateUser (
  createUserUseCase: CreateUserUseCase,
  event: APIGatewayProxyEventV2,
  session: ValidatedSession
): Promise<APIGatewayProxyStructuredResultV2> {
  if (session.role !== 'admin') {
    return jsonResponse(403, { error: 'forbidden' })
  }

  const body = JSON.parse(event.body ?? '{}') as CreateUserRequestBody
  if (body.email === undefined || body.password === undefined || body.role === undefined) {
    return jsonResponse(400, { error: 'invalid_request' })
  }
  if (body.password.length < MIN_PASSWORD_LENGTH) {
    return jsonResponse(400, { error: 'invalid_request' })
  }
  if (!isValidRole(body.role)) {
    return jsonResponse(400, { error: 'invalid_request' })
  }

  try {
    const created: UserEntity = await createUserUseCase.execute(body.email, body.password, body.role)
    return jsonResponse(201, { user_id: created.userId, email: created.email, role: created.role })
  } catch (error) {
    if (error instanceof UserAlreadyExistsError) {
      return jsonResponse(409, { error: 'already_exists' })
    }
    throw error
  }
}

/**
 * `PATCH /api/admin/users/:id` — writes require `role === 'admin'`. A
 * single combined endpoint for deactivation, reactivation, and role
 * reassignment (design API contract). `409 last_admin` when the change
 * would leave zero active admins (including self-deactivation);
 * `404 not_found` for an unknown user.
 */
export async function handleUpdateUser (
  updateUserUseCase: UpdateUserUseCase,
  event: APIGatewayProxyEventV2,
  userId: string,
  session: ValidatedSession
): Promise<APIGatewayProxyStructuredResultV2> {
  if (session.role !== 'admin') {
    return jsonResponse(403, { error: 'forbidden' })
  }

  const body = JSON.parse(event.body ?? '{}') as UpdateUserRequestBody
  if (!isValidRole(body.role) && body.role !== undefined) {
    return jsonResponse(400, { error: 'invalid_request' })
  }
  if (!isValidStatus(body.status)) {
    return jsonResponse(400, { error: 'invalid_request' })
  }

  try {
    const updated: UserEntity = await updateUserUseCase.execute(userId, {
      role: isValidRole(body.role) ? body.role : undefined,
      status: body.status as UserStatus | undefined
    })
    return jsonResponse(200, { user_id: updated.userId, email: updated.email, role: updated.role, status: updated.status ?? 'active' })
  } catch (error) {
    if (error instanceof UserNotFoundError) {
      return jsonResponse(404, { error: 'not_found' })
    }
    if (error instanceof LastAdminError) {
      return jsonResponse(409, { error: 'last_admin' })
    }
    throw error
  }
}
