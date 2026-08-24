/**
 * Supported BFF routes. All routes are attached via a single API Gateway
 * `ANY /api/admin/{proxy+}` route (task 3.1), so this table — not
 * Terraform — is the source of truth for path/method dispatch, including
 * the `:id` path param used by the config CRUD routes (tasks 3.5-3.13)
 * and the auth-proxy routes (bff-auth-routing-decision).
 */
export type AdminRoute =
  | 'health'
  | 'config.list'
  | 'config.add'
  | 'config.get'
  | 'config.update'
  | 'repos.list'
  | 'repos.scans'
  | 'repos.triggerScan'
  | 'repos.defaultBranch'
  | 'scans.get'
  | 'apiKeys.list'
  | 'apiKeys.create'
  | 'apiKeys.revoke'
  | 'users.list'
  | 'users.create'
  | 'users.update'
  | 'auth.login'
  | 'auth.logout'
  | 'auth.me'

export interface ResolvedRoute {
  route: AdminRoute
  params: Record<string, string>
}

interface RouteDefinition {
  method: string
  segments: string[]
  route: AdminRoute
}

const ROUTES: RouteDefinition[] = [
  { method: 'GET', segments: ['api', 'admin', 'health'], route: 'health' },
  { method: 'GET', segments: ['api', 'admin', 'config'], route: 'config.list' },
  { method: 'POST', segments: ['api', 'admin', 'config'], route: 'config.add' },
  { method: 'GET', segments: ['api', 'admin', 'config', ':id'], route: 'config.get' },
  { method: 'PUT', segments: ['api', 'admin', 'config', ':id'], route: 'config.update' },
  { method: 'GET', segments: ['api', 'admin', 'repos'], route: 'repos.list' },
  { method: 'GET', segments: ['api', 'admin', 'repos', ':id', 'scans'], route: 'repos.scans' },
  { method: 'POST', segments: ['api', 'admin', 'repos', ':id', 'trigger-scan'], route: 'repos.triggerScan' },
  { method: 'GET', segments: ['api', 'admin', 'repos', ':id', 'default-branch'], route: 'repos.defaultBranch' },
  { method: 'GET', segments: ['api', 'admin', 'scans', ':id'], route: 'scans.get' },
  { method: 'GET', segments: ['api', 'admin', 'api-keys'], route: 'apiKeys.list' },
  { method: 'POST', segments: ['api', 'admin', 'api-keys'], route: 'apiKeys.create' },
  { method: 'POST', segments: ['api', 'admin', 'api-keys', ':id', 'revoke'], route: 'apiKeys.revoke' },
  { method: 'GET', segments: ['api', 'admin', 'users'], route: 'users.list' },
  { method: 'POST', segments: ['api', 'admin', 'users'], route: 'users.create' },
  { method: 'PATCH', segments: ['api', 'admin', 'users', ':id'], route: 'users.update' },
  { method: 'POST', segments: ['api', 'admin', 'auth', 'login'], route: 'auth.login' },
  { method: 'POST', segments: ['api', 'admin', 'auth', 'logout'], route: 'auth.logout' },
  { method: 'GET', segments: ['api', 'admin', 'auth', 'me'], route: 'auth.me' }
]

/**
 * Resolves an incoming HTTP method + path to one of this Lambda's
 * supported admin routes, extracting any `:id`-style path params.
 * Returns `undefined` when there is no match (callers should respond
 * with 404).
 */
export function resolveRoute (method: string, path: string): ResolvedRoute | undefined {
  const normalizedMethod = method.toUpperCase()
  const pathSegments = path.split('/').filter(segment => segment.length > 0)

  for (const definition of ROUTES) {
    if (definition.method !== normalizedMethod) {
      continue
    }
    if (definition.segments.length !== pathSegments.length) {
      continue
    }

    const params: Record<string, string> = {}
    let matched = true

    for (let i = 0; i < definition.segments.length; i++) {
      const definitionSegment = definition.segments[i]
      const actualSegment = pathSegments[i]

      if (definitionSegment.startsWith(':')) {
        params[definitionSegment.slice(1)] = decodeURIComponent(actualSegment)
      } else if (definitionSegment !== actualSegment) {
        matched = false
        break
      }
    }

    if (matched) {
      return { route: definition.route, params }
    }
  }

  return undefined
}
