import { describe, expect, it } from 'vitest'
import { resolveRoute } from '../../src/utils/routes'

// `resolveRoute` was ported verbatim from titvo-auth-setup-aws in Batch 5
// (approval tests, see apply-progress Deviations) then extended here to
// support path params (`:id`) for the config CRUD routes and the new
// auth-proxy routes (tasks 3.5-3.13 + the auth-routing decision). The
// return shape changed from a bare `AdminRoute` string to
// `{route, params}` to carry the extracted `:id` — this is a genuine,
// test-first contract change for this batch, not a silent break: these
// tests were updated alongside the new production code, RED-confirmed
// against the OLD string-returning implementation before the change.
describe('resolveRoute', () => {
  it('resolves GET /api/admin/health to the health route with no params', () => {
    expect(resolveRoute('GET', '/api/admin/health')).toEqual({ route: 'health', params: {} })
  })

  it('is case-insensitive on method', () => {
    expect(resolveRoute('get', '/api/admin/health')).toEqual({ route: 'health', params: {} })
  })

  it('returns undefined for an unknown path (caller responds 404)', () => {
    expect(resolveRoute('GET', '/api/admin/unknown')).toBeUndefined()
  })

  it('returns undefined when the method does not match the known route', () => {
    expect(resolveRoute('POST', '/api/admin/health')).toBeUndefined()
  })

  it('resolves GET /api/admin/config to config.list', () => {
    expect(resolveRoute('GET', '/api/admin/config')).toEqual({ route: 'config.list', params: {} })
  })

  it('resolves POST /api/admin/config to config.add', () => {
    expect(resolveRoute('POST', '/api/admin/config')).toEqual({ route: 'config.add', params: {} })
  })

  it('resolves GET /api/admin/config/:id to config.get, extracting the id', () => {
    expect(resolveRoute('GET', '/api/admin/config/db-password')).toEqual({ route: 'config.get', params: { id: 'db-password' } })
  })

  it('resolves PUT /api/admin/config/:id to config.update, extracting the id', () => {
    expect(resolveRoute('PUT', '/api/admin/config/db-password')).toEqual({ route: 'config.update', params: { id: 'db-password' } })
  })

  it('does not confuse GET /api/admin/config/:id with GET /api/admin/config (different segment counts)', () => {
    expect(resolveRoute('GET', '/api/admin/config/x/y')).toBeUndefined()
  })

  it('resolves POST /api/admin/auth/login to auth.login', () => {
    expect(resolveRoute('POST', '/api/admin/auth/login')).toEqual({ route: 'auth.login', params: {} })
  })

  it('resolves POST /api/admin/auth/logout to auth.logout', () => {
    expect(resolveRoute('POST', '/api/admin/auth/logout')).toEqual({ route: 'auth.logout', params: {} })
  })

  it('resolves GET /api/admin/auth/me to auth.me', () => {
    expect(resolveRoute('GET', '/api/admin/auth/me')).toEqual({ route: 'auth.me', params: {} })
  })

  it('resolves GET /api/admin/repos to repos.list', () => {
    expect(resolveRoute('GET', '/api/admin/repos')).toEqual({ route: 'repos.list', params: {} })
  })

  it('resolves GET /api/admin/repos/:id/scans to repos.scans, extracting the id', () => {
    expect(resolveRoute('GET', '/api/admin/repos/repo-1/scans')).toEqual({ route: 'repos.scans', params: { id: 'repo-1' } })
  })

  it('resolves GET /api/admin/scans/:id to scans.get, extracting the id', () => {
    expect(resolveRoute('GET', '/api/admin/scans/scan-1')).toEqual({ route: 'scans.get', params: { id: 'scan-1' } })
  })

  it('does not confuse GET /api/admin/repos/:id/scans with GET /api/admin/repos (different segment counts)', () => {
    expect(resolveRoute('GET', '/api/admin/repos/repo-1')).toBeUndefined()
  })

  it('resolves POST /api/admin/repos/:id/trigger-scan to repos.triggerScan, extracting the id', () => {
    expect(resolveRoute('POST', '/api/admin/repos/repo-1/trigger-scan')).toEqual({ route: 'repos.triggerScan', params: { id: 'repo-1' } })
  })

  it('does not confuse POST /api/admin/repos/:id/trigger-scan with GET /api/admin/repos/:id/scans (different method)', () => {
    expect(resolveRoute('GET', '/api/admin/repos/repo-1/trigger-scan')).toBeUndefined()
  })

  it('resolves GET /api/admin/repos/:id/default-branch to repos.defaultBranch, extracting the id', () => {
    expect(resolveRoute('GET', '/api/admin/repos/repo-1/default-branch')).toEqual({ route: 'repos.defaultBranch', params: { id: 'repo-1' } })
  })

  it('resolves GET /api/admin/api-keys to apiKeys.list', () => {
    expect(resolveRoute('GET', '/api/admin/api-keys')).toEqual({ route: 'apiKeys.list', params: {} })
  })

  it('resolves POST /api/admin/api-keys to apiKeys.create', () => {
    expect(resolveRoute('POST', '/api/admin/api-keys')).toEqual({ route: 'apiKeys.create', params: {} })
  })

  it('resolves POST /api/admin/api-keys/:id/revoke to apiKeys.revoke, extracting the id', () => {
    expect(resolveRoute('POST', '/api/admin/api-keys/key-1/revoke')).toEqual({ route: 'apiKeys.revoke', params: { id: 'key-1' } })
  })

  it('does not confuse POST /api/admin/api-keys/:id/revoke with POST /api/admin/api-keys (different segment counts)', () => {
    expect(resolveRoute('POST', '/api/admin/api-keys/key-1')).toBeUndefined()
  })

  it('resolves GET /api/admin/users to users.list', () => {
    expect(resolveRoute('GET', '/api/admin/users')).toEqual({ route: 'users.list', params: {} })
  })

  it('resolves POST /api/admin/users to users.create', () => {
    expect(resolveRoute('POST', '/api/admin/users')).toEqual({ route: 'users.create', params: {} })
  })

  it('resolves PATCH /api/admin/users/:id to users.update, extracting the id', () => {
    expect(resolveRoute('PATCH', '/api/admin/users/user-1')).toEqual({ route: 'users.update', params: { id: 'user-1' } })
  })

  it('does not confuse PATCH /api/admin/users/:id with POST /api/admin/users (different segment counts)', () => {
    expect(resolveRoute('PATCH', '/api/admin/users')).toBeUndefined()
  })
})
