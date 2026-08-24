import { NestFactory } from '@nestjs/core'
import { Context, APIGatewayProxyCallbackV2, APIGatewayProxyEventV2, APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { INestApplicationContext, Logger as NestLogger } from '@nestjs/common'
import { Logger } from 'nestjs-pino'
import { LoginUseCase, LogoutUseCase, ValidatedSession, CreateUserUseCase } from '@titvo/auth'
import { AppModule } from './app.module'
import { SessionGuardService } from './infrastructure/auth/session-guard.service'
import { withAuthGuard } from './infrastructure/auth/with-auth-guard'
import { resolveRoute } from './utils/routes'
import { jsonResponse } from './utils/http-responses'
import { handleHealth } from './infrastructure/health/health.handler'
import { handleLogin } from './infrastructure/auth/login.handler'
import { handleLogout } from './infrastructure/auth/logout.handler'
import { handleMe } from './infrastructure/auth/me.handler'
import { handleListConfig, handleGetConfig, handleAddConfig, handleUpdateConfig } from './infrastructure/config/config.handler'
import { ListConfigUseCase } from './app/config/list-config.use-case'
import { GetConfigUseCase } from './app/config/get-config.use-case'
import { AddConfigUseCase } from './app/config/add-config.use-case'
import { UpdateConfigUseCase } from './app/config/update-config.use-case'
import { handleListRepos } from './infrastructure/repo/repos.handler'
import { handleListScansForRepo, handleGetScan, handleTriggerScan, handleGetDefaultBranch } from './infrastructure/scan/scans.handler'
import { ListReposUseCase } from './app/repo/list-repos.use-case'
import { ListScansForRepoUseCase } from './app/scan/list-scans-for-repo.use-case'
import { GetScanUseCase } from './app/scan/get-scan.use-case'
import { TriggerScanUseCase } from './app/scan/trigger-scan.use-case'
import { GetDefaultBranchUseCase } from './app/scan/get-default-branch.use-case'
import { handleListApiKeys, handleCreateApiKey, handleRevokeApiKey } from './infrastructure/api-key/api-keys.handler'
import { ListApiKeysUseCase } from './app/api-key/list-api-keys.use-case'
import { CreateApiKeyUseCase } from './app/api-key/create-api-key.use-case'
import { RevokeApiKeyUseCase } from './app/api-key/revoke-api-key.use-case'
import { handleListUsers, handleCreateUser, handleUpdateUser } from './infrastructure/user/users.handler'
import { ListUsersUseCase } from './app/user/list-users.use-case'
import { UpdateUserUseCase } from './app/user/update-user.use-case'

const logger = new NestLogger('AdminBffHandler')

async function initApp (): Promise<INestApplicationContext> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true
  })
  await app.init()
  app.useLogger(app.get(Logger))
  app.flushLogs()
  return app
}

const app = await initApp()

// Resolved here (not inside the handler) so each is instantiated once per
// Lambda execution environment, matching this ecosystem's
// createApplicationContext pattern.
const sessionGuard = app.get(SessionGuardService)
const loginUseCase = app.get(LoginUseCase)
const logoutUseCase = app.get(LogoutUseCase)
const listConfigUseCase = app.get(ListConfigUseCase)
const getConfigUseCase = app.get(GetConfigUseCase)
const addConfigUseCase = app.get(AddConfigUseCase)
const updateConfigUseCase = app.get(UpdateConfigUseCase)
const listReposUseCase = app.get(ListReposUseCase)
const listScansForRepoUseCase = app.get(ListScansForRepoUseCase)
const getScanUseCase = app.get(GetScanUseCase)
const triggerScanUseCase = app.get(TriggerScanUseCase)
const getDefaultBranchUseCase = app.get(GetDefaultBranchUseCase)
const listApiKeysUseCase = app.get(ListApiKeysUseCase)
const createApiKeyUseCase = app.get(CreateApiKeyUseCase)
const revokeApiKeyUseCase = app.get(RevokeApiKeyUseCase)
const listUsersUseCase = app.get(ListUsersUseCase)
const createUserUseCase = app.get(CreateUserUseCase)
const updateUserUseCase = app.get(UpdateUserUseCase)

export const handler: APIGatewayProxyHandlerV2 = async (event: APIGatewayProxyEventV2, context: Context, callback: APIGatewayProxyCallbackV2): Promise<ReturnType<typeof jsonResponse>> => {
  logger.debug(`Received event: ${event.rawPath}`)

  const resolved = resolveRoute(event.requestContext.http.method, event.rawPath)

  if (resolved === undefined) {
    return jsonResponse(404, { error: 'not_found' })
  }

  switch (resolved.route) {
    case 'health':
      // Deliberately unauthenticated (liveness check).
      return await handleHealth()

    case 'auth.login':
      // Deliberately unauthenticated (this IS the authentication step).
      return await handleLogin(loginUseCase, event)

    case 'auth.logout':
      // Deliberately unauthenticated — logout must succeed even with a
      // missing/expired cookie (idempotent, never surfaces 401).
      return await handleLogout(logoutUseCase, event)

    case 'auth.me':
      return await withAuthGuard(sessionGuard, event, async (session: ValidatedSession): Promise<APIGatewayProxyStructuredResultV2> => await handleMe(session))

    case 'config.list':
      return await withAuthGuard(sessionGuard, event, async (): Promise<APIGatewayProxyStructuredResultV2> => await handleListConfig(listConfigUseCase))

    case 'config.get':
      return await withAuthGuard(sessionGuard, event, async (): Promise<APIGatewayProxyStructuredResultV2> => await handleGetConfig(getConfigUseCase, resolved.params.id))

    case 'config.add':
      return await withAuthGuard(sessionGuard, event, async (session: ValidatedSession): Promise<APIGatewayProxyStructuredResultV2> => await handleAddConfig(addConfigUseCase, event, session))

    case 'config.update':
      return await withAuthGuard(sessionGuard, event, async (session: ValidatedSession): Promise<APIGatewayProxyStructuredResultV2> => await handleUpdateConfig(updateConfigUseCase, event, resolved.params.id, session))

    case 'repos.list':
      // Read-accessible to member AND admin — repo/scan visibility has no write surface (spec).
      return await withAuthGuard(sessionGuard, event, async (): Promise<APIGatewayProxyStructuredResultV2> => await handleListRepos(listReposUseCase))

    case 'repos.scans':
      return await withAuthGuard(sessionGuard, event, async (): Promise<APIGatewayProxyStructuredResultV2> => await handleListScansForRepo(listScansForRepoUseCase, resolved.params.id))

    case 'repos.triggerScan':
      return await withAuthGuard(sessionGuard, event, async (session: ValidatedSession): Promise<APIGatewayProxyStructuredResultV2> => await handleTriggerScan(triggerScanUseCase, event, resolved.params.id, session))

    case 'repos.defaultBranch':
      return await withAuthGuard(sessionGuard, event, async (session: ValidatedSession): Promise<APIGatewayProxyStructuredResultV2> => await handleGetDefaultBranch(getDefaultBranchUseCase, resolved.params.id, session))

    case 'scans.get':
      return await withAuthGuard(sessionGuard, event, async (): Promise<APIGatewayProxyStructuredResultV2> => await handleGetScan(getScanUseCase, resolved.params.id))

    case 'apiKeys.list':
      // Read-accessible to member AND admin (design D8) — only create/revoke are admin-only writes.
      return await withAuthGuard(sessionGuard, event, async (): Promise<APIGatewayProxyStructuredResultV2> => await handleListApiKeys(listApiKeysUseCase))

    case 'apiKeys.create':
      return await withAuthGuard(sessionGuard, event, async (session: ValidatedSession): Promise<APIGatewayProxyStructuredResultV2> => await handleCreateApiKey(createApiKeyUseCase, event, session))

    case 'apiKeys.revoke':
      return await withAuthGuard(sessionGuard, event, async (session: ValidatedSession): Promise<APIGatewayProxyStructuredResultV2> => await handleRevokeApiKey(revokeApiKeyUseCase, resolved.params.id, session))

    case 'users.list':
      // Read-accessible to member AND admin (spec: "List Users") — only create/update are admin-only writes.
      return await withAuthGuard(sessionGuard, event, async (): Promise<APIGatewayProxyStructuredResultV2> => await handleListUsers(listUsersUseCase))

    case 'users.create':
      return await withAuthGuard(sessionGuard, event, async (session: ValidatedSession): Promise<APIGatewayProxyStructuredResultV2> => await handleCreateUser(createUserUseCase, event, session))

    case 'users.update':
      return await withAuthGuard(sessionGuard, event, async (session: ValidatedSession): Promise<APIGatewayProxyStructuredResultV2> => await handleUpdateUser(updateUserUseCase, event, resolved.params.id, session))

    default:
      return jsonResponse(404, { error: 'not_found' })
  }
}
