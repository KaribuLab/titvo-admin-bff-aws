import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import { createWebFunctionServer, parseHttpEndpoint } from '../../src/web-functions/adapter'
import { handleLogin } from '../../src/infrastructure/auth/login.handler'
import { handleLogout } from '../../src/infrastructure/auth/logout.handler'
import { handleMe } from '../../src/infrastructure/auth/me.handler'
import { buildSessionCookie, buildClearSessionCookie, extractSessionToken } from '../../src/utils/cookies'
import { SESSION_TTL_SECONDS } from '@titvo/auth'
import type { LoginUseCase, LogoutUseCase, ValidatedSession } from '@titvo/auth'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(async server => await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })))
})

async function serve (handler: (event: APIGatewayProxyEventV2) => unknown, maxBodyBytes?: number): Promise<number> {
  const server = createWebFunctionServer(handler, { maxBodyBytes })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}

async function send (port: number, path = '/api/admin/health', method = 'GET', body?: string | Buffer, headers: Record<string, string | string[]> = {}) {
  return await new Promise<{ status: number, headers: import('node:http').IncomingHttpHeaders, body: string, bytes: Buffer }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers, agent: false }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        const bytes = Buffer.concat(chunks)
        resolve({ status: res.statusCode!, headers: res.headers, body: bytes.toString(), bytes })
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

function expectJson (result: Awaited<ReturnType<typeof send>>, status: number, body: string) {
  expect(result.status).toBe(status)
  expect(result.body).toBe(body)
  expect(result.headers['content-type']).toBe('application/json')
}

describe('pilot HTTP boundary', () => {
  it('preserves v2 raw path, query, method, headers, cookies and text body', async () => {
    const handler = vi.fn((_event: APIGatewayProxyEventV2) => ({ statusCode: 201, headers: { 'X-Result': 'yes' }, body: 'ok' }))
    const port = await serve(handler)
    const response = await send(port, '/api/admin/auth/login?a=one%20two&a=three&empty=', 'POST', '{"email":"a","password":"b"}', {
      'content-type': 'application/json', 'x-custom': 'value', cookie: ['one=1', 'two=2']
    })
    expect(response.status).toBe(201)
    expect(response.body).toBe('ok')
    expect(response.headers['x-result']).toBe('yes')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toMatchObject({
      version: '2.0', rawPath: '/api/admin/auth/login', rawQueryString: 'a=one%20two&a=three&empty=',
      queryStringParameters: { a: 'one two,three', empty: '' }, cookies: ['one=1', 'two=2'],
      headers: { 'content-type': 'application/json', 'x-custom': 'value', cookie: 'one=1; two=2' },
      requestContext: { stage: '$default', http: { method: 'POST', path: '/api/admin/auth/login' } },
      body: '{"email":"a","password":"b"}', isBase64Encoded: false
    })
  })

  it.each([
    ['GET', '/api/admin/health'], ['POST', '/api/admin/auth/login'],
    ['POST', '/api/admin/auth/logout'], ['GET', '/api/admin/auth/me'], ['GET', '/api/admin/config']
  ])('dispatches only the approved %s %s route', async (method, path) => {
    const handler = vi.fn(() => ({ statusCode: 200, body: 'allowed' }))
    const response = await send(await serve(handler), path, method)
    expect(response.status).toBe(200)
    expect(response.body).toBe('allowed')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['POST', '/api/admin/config'], ['GET', '/api/admin/config/key'], ['GET', '/api/admin/repos'],
    ['POST', '/api/admin/repos/id/scans'], ['GET', '/api/admin/users'], ['GET', '/api/admin/api-keys'],
    ['GET', '/v1/api/admin/health'], ['HEAD', '/api/admin/health'], ['OPTIONS', '/api/admin/health'],
    ['GET', '/api/admin/health/'], ['GET', '/api/admin/%68ealth'], ['GET', '/other/../api/admin/health']
  ])('rejects %s %s without dispatch', async (method, path) => {
    const handler = vi.fn()
    const response = await send(await serve(handler), path, method)
    expect(response.status).toBe(404)
    // HTTP suppresses bodies for HEAD.
    expect(response.body).toBe(method === 'HEAD' ? '' : '{"error":"not_found"}')
    expect(response.headers['content-type']).toBe('application/json')
    expect(handler).not.toHaveBeenCalled()
  })

  it.each(['/api/admin/%ZZ', '/api/admin/%E0%A4', '/api/admin/health?x=%ZZ', '//api/admin/health', '/api/admin/health#fragment'])('rejects malformed target %s without dispatch', async path => {
    const handler = vi.fn()
    expectJson(await send(await serve(handler), path), 400, '{"error":"invalid_request"}')
    expect(handler).not.toHaveBeenCalled()
  })

  it('bounds both declared and chunked bodies, accepting the exact byte boundary', async () => {
    const handler = vi.fn(() => ({ statusCode: 200, body: 'ok' }))
    const port = await serve(handler, 4)
    expectJson(await send(port, '/api/admin/auth/logout', 'POST', '12345', { 'content-length': '5' }), 413, '{"error":"payload_too_large"}')
    expectJson(await send(port, '/api/admin/auth/logout', 'POST', '12345', { 'transfer-encoding': 'chunked' }), 413, '{"error":"payload_too_large"}')
    expect(handler).not.toHaveBeenCalled()
    const accepted = await send(port, '/api/admin/auth/logout', 'POST', '1234', { 'content-type': 'text/plain' })
    expect(accepted.status).toBe(200)
    expect(accepted.body).toBe('ok')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it.each(['{broken', 'null', '[]'])('rejects malformed/non-object login JSON %s without dispatch', async body => {
    const handler = vi.fn()
    expectJson(await send(await serve(handler), '/api/admin/auth/login', 'POST', body, { 'content-type': 'application/json' }), 400, '{"error":"invalid_request"}')
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects invalid UTF-8 without dispatch or corrupting the next request', async () => {
    const handler = vi.fn(() => ({ statusCode: 200, body: 'ok' }))
    const port = await serve(handler)
    expectJson(await send(port, '/api/admin/auth/login', 'POST', Buffer.from([0xff]), { 'content-type': 'application/json' }), 400, '{"error":"invalid_request"}')
    expect(handler).not.toHaveBeenCalled()
    const response = await send(port)
    expect(response.status).toBe(200)
    expect(response.body).toBe('ok')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('preserves binary request/response bodies and multiple cookie sources', async () => {
    const binary = Buffer.from([0, 255, 128, 42])
    const handler = vi.fn((_event: APIGatewayProxyEventV2) => ({
      statusCode: 200, headers: { 'content-type': 'application/octet-stream', 'Set-Cookie': 'legacy=1; HttpOnly' },
      cookies: ['first=2; Secure', 'second=3; SameSite=Strict'], body: binary.toString('base64'), isBase64Encoded: true
    }))
    const response = await send(await serve(handler), '/api/admin/auth/logout', 'POST', binary, { 'content-type': 'application/octet-stream' })
    expect(response.status).toBe(200)
    expect(response.bytes).toEqual(binary)
    expect(response.headers['set-cookie']).toEqual(['legacy=1; HttpOnly', 'first=2; Secure', 'second=3; SameSite=Strict'])
    expect(handler.mock.calls[0][0]).toMatchObject({ body: binary.toString('base64'), isBase64Encoded: true })
  })

  it('preserves 204 and its cookie without emitting a body', async () => {
    const response = await send(await serve(() => ({ statusCode: 204, cookies: ['a=; Max-Age=0'], body: 'discard' })))
    expect(response.status).toBe(204)
    expect(response.body).toBe('')
    expect(response.headers['set-cookie']).toEqual(['a=; Max-Age=0'])
  })

  it('contains thrown and rejected errors and remains usable without leaking details', async () => {
    const handler = vi.fn().mockRejectedValueOnce(new Error('SECRET_TOKEN')).mockImplementationOnce(() => { throw new Error('SECRET_TOKEN') }).mockResolvedValue({ statusCode: 200, body: 'healthy' })
    const port = await serve(handler)
    expectJson(await send(port), 500, '{"error":"internal_error"}')
    expectJson(await send(port), 500, '{"error":"internal_error"}')
    const recovered = await send(port)
    expect(recovered.status).toBe(200)
    expect(recovered.body).toBe('healthy')
  })

  it.each([undefined, null, 'SECRET_TOKEN', { statusCode: 99 }, { statusCode: 200, body: {} },
    { statusCode: 200, headers: { 'x-secret': 'SECRET\r\nTOKEN' } },
    { statusCode: 200, cookies: [42] }, { statusCode: 200, body: '!!', isBase64Encoded: true }
  ])('contains invalid handler results %#', async result => {
    expectJson(await send(await serve(() => result)), 502, '{"error":"invalid_response"}')
  })
})

describe('real auth handlers over HTTP with fake use cases', () => {
  it('keeps simultaneous session identities and cookies isolated through login/me/logout', async () => {
    const sessions = new Map<string, ValidatedSession>()
    const login = { execute: vi.fn(async (email: string) => {
      await new Promise(resolve => setTimeout(resolve, email === 'alice@example.test' ? 10 : 1))
      const userId = email.split('@')[0]
      const token = `token-${userId}`
      sessions.set(token, { userId, email, role: 'admin' } as ValidatedSession)
      return { token, user: { userId, email, role: 'admin' } }
    }) }
    const logout = { execute: vi.fn(async (token: string) => { sessions.delete(token) }) }
    const port = await serve(async event => {
      if (event.rawPath.endsWith('/login')) return await handleLogin(login as unknown as LoginUseCase, event)
      if (event.rawPath.endsWith('/logout')) return await handleLogout(logout as unknown as LogoutUseCase, event)
      const session = sessions.get(extractSessionToken(event.headers.cookie) ?? '')
      return session ? await handleMe(session) : { statusCode: 401, headers: { 'content-type': 'application/json' }, body: '{"error":"unauthorized"}' }
    })
    const users = ['alice', 'bob']
    const logins = await Promise.all(users.map(async user => await send(port, '/api/admin/auth/login', 'POST', JSON.stringify({ email: `${user}@example.test`, password: 'fake' }), { 'content-type': 'application/json' })))
    for (const [i, response] of logins.entries()) {
      expectJson(response, 200, JSON.stringify({ user_id: users[i], email: `${users[i]}@example.test`, role: 'admin' }))
      expect(response.headers['set-cookie']).toEqual([buildSessionCookie({ token: `token-${users[i]}`, maxAgeSeconds: SESSION_TTL_SECONDS })])
    }
    const identities = await Promise.all(users.map(async user => await send(port, '/api/admin/auth/me', 'GET', undefined, { cookie: `tvo_session=token-${user}` })))
    identities.forEach((response, i) => expectJson(response, 200, JSON.stringify({ user_id: users[i], email: `${users[i]}@example.test`, role: 'admin' })))
    const rejected = await send(port, '/api/admin/auth/login', 'POST', '{broken', { 'content-type': 'application/json' })
    expectJson(rejected, 400, '{"error":"invalid_request"}')
    expect(login.execute).toHaveBeenCalledTimes(2)
    expect(logout.execute).not.toHaveBeenCalled()
    const cleared = await send(port, '/api/admin/auth/logout', 'POST', undefined, { cookie: 'tvo_session=token-alice' })
    expect(cleared.status).toBe(204)
    expect(cleared.body).toBe('')
    expect(cleared.headers['set-cookie']).toEqual([buildClearSessionCookie()])
    expect(logout.execute).toHaveBeenCalledTimes(1)
    expect(logout.execute).toHaveBeenCalledWith('token-alice')
    expectJson(await send(port, '/api/admin/auth/me', 'GET', undefined, { cookie: 'tvo_session=token-alice' }), 401, '{"error":"unauthorized"}')
    expectJson(await send(port, '/api/admin/auth/me', 'GET', undefined, { cookie: 'tvo_session=token-bob' }), 200, '{"user_id":"bob","email":"bob@example.test","role":"admin"}')
  })
})

describe('listen endpoint', () => {
  it.each(['127.0.0.1:3001', '0.0.0.0:8080', 'localhost:80', '[::1]:8080'])('accepts %s', value => {
    const port = Number(value.slice(value.lastIndexOf(':') + 1))
    expect(parseHttpEndpoint(value)).toEqual({ host: value.startsWith('[') ? '::1' : value.split(':')[0], port })
  })
  it('uses an explicit local fallback only outside AWS', () => {
    expect(parseHttpEndpoint(undefined, {})).toEqual({ host: '127.0.0.1', port: 3001 })
    expect(parseHttpEndpoint(undefined, { PORT: '9999' })).toEqual({ host: '127.0.0.1', port: 3001 })
    expect(() => parseHttpEndpoint(undefined, { AWS_LAMBDA_FUNCTION_NAME: 'pilot' })).toThrow('AWS_LAMBDA_HTTP_ENDPOINT is required in AWS')
  })
  it.each(['', 'http://localhost:80', 'localhost', ':80', 'localhost:0', 'localhost:65536', 'localhost:3.5', 'localhost:80/path', 'localhost: 80', 'a b:80', '::1:80', 'a..b:80', '-bad.example:80', 'ok.-bad:80', 'ok.bad-:80'])('rejects invalid endpoint %s', value => {
    expect(() => parseHttpEndpoint(value)).toThrow('Invalid AWS_LAMBDA_HTTP_ENDPOINT')
  })
})
