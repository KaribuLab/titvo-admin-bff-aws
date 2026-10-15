import { createServer, validateHeaderName, validateHeaderValue } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import { randomUUID } from 'node:crypto'
import type { APIGatewayProxyEventV2 } from 'aws-lambda'

export type WebFunctionHandler = (event: APIGatewayProxyEventV2) => unknown
const allowedRoutes = new Set([
  'GET /api/admin/health',
  'POST /api/admin/auth/login',
  'POST /api/admin/auth/logout',
  'GET /api/admin/auth/me',
  'GET /api/admin/config'
])
const defaultMaxBodyBytes = 1024 * 1024

/** AWS supplies host:port, not PORT. Local fallback never binds a public interface. */
export function parseHttpEndpoint (
  value: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): { host: string, port: number } {
  if (value === undefined) {
    if (env.AWS_LAMBDA_FUNCTION_NAME !== undefined || env.AWS_EXECUTION_ENV !== undefined || env.AWS_LAMBDA_RUNTIME_API !== undefined) {
      throw new Error('AWS_LAMBDA_HTTP_ENDPOINT is required in AWS')
    }
    return { host: '127.0.0.1', port: 3001 }
  }
  const match = /^(?:\[([0-9a-fA-F:]+)\]|([a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?)):([0-9]+)$/.exec(value)
  if (match === null) throw new Error('Invalid AWS_LAMBDA_HTTP_ENDPOINT')
  const host = match[1] ?? match[2]
  const port = Number(match[3])
  const validHost = match[1] !== undefined
    ? isIP(host) === 6
    : host.length <= 253 && host.split('.').every(label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))
  if (!validHost || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid AWS_LAMBDA_HTTP_ENDPOINT')
  }
  return { host, port }
}

class RequestFailure extends Error {
  constructor (readonly status: number, readonly code: string) { super(code) }
}

function jsonError (res: ServerResponse, status: number, code: string): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: code }))
}

function parseTarget (target: string): { path: string, query: string } {
  // Do not use URL.pathname: WHATWG URL normalizes dot segments before allowlisting.
  if (!target.startsWith('/') || target.startsWith('//') || /[#\u0000-\u0020\u007f\\]/.test(target)) {
    throw new RequestFailure(400, 'invalid_request')
  }
  const separator = target.indexOf('?')
  const path = separator < 0 ? target : target.slice(0, separator)
  const query = separator < 0 ? '' : target.slice(separator + 1)
  try {
    decodeURIComponent(path)
    decodeURIComponent(query)
  } catch {
    throw new RequestFailure(400, 'invalid_request')
  }
  return { path, query }
}

async function readBody (req: IncomingMessage, limit: number): Promise<Buffer> {
  if (Number(req.headers['content-length'] ?? 0) > limit) {
    req.resume()
    throw new RequestFailure(413, 'payload_too_large')
  }
  const chunks: Buffer[] = []
  let size = 0
  // Event-based consumption lets us drain excess data without destroying the socket
  // before the deterministic 413 response can be sent.
  return await new Promise((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        chunks.length = 0
        reject(new RequestFailure(413, 'payload_too_large'))
      } else {
        chunks.push(chunk)
      }
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', () => reject(new RequestFailure(400, 'invalid_request')))
    req.on('aborted', () => reject(new RequestFailure(400, 'invalid_request')))
  })
}

function toEvent (req: IncomingMessage, path: string, query: string, bytes: Buffer): APIGatewayProxyEventV2 {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(',') : value
  }
  const contentType = (headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  const login = path === '/api/admin/auth/login'
  const isJson = contentType === 'application/json' || contentType.endsWith('+json') || login
  const textual = isJson || contentType === '' || contentType.startsWith('text/') || contentType === 'application/x-www-form-urlencoded'
  let body: string | undefined
  if (bytes.length > 0) {
    if (textual) {
      try {
        body = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        if (isJson) {
          const parsed: unknown = JSON.parse(body)
          if (login && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('invalid object')
        }
      } catch {
        throw new RequestFailure(400, 'invalid_request')
      }
    } else {
      body = bytes.toString('base64')
    }
  }
  const queryStringParameters: Record<string, string> = {}
  new URLSearchParams(query).forEach((value, key) => {
    Object.defineProperty(queryStringParameters, key, {
      value: Object.hasOwn(queryStringParameters, key) ? `${queryStringParameters[key]},${value}` : value,
      enumerable: true, configurable: true
    })
  })
  const requestId = randomUUID()
  return {
    version: '2.0', routeKey: '$default', rawPath: path, rawQueryString: query,
    headers, cookies: headers.cookie?.split(';').map(cookie => cookie.trim()).filter(Boolean),
    queryStringParameters: query === '' ? undefined : queryStringParameters,
    requestContext: {
      accountId: 'pilot', apiId: 'web-functions', domainName: headers.host ?? 'localhost',
      domainPrefix: 'pilot', requestId, routeKey: '$default', stage: '$default',
      time: new Date().toISOString(), timeEpoch: Date.now(),
      http: {
        method: req.method ?? 'GET', path, protocol: `HTTP/${req.httpVersion}`,
        sourceIp: req.socket.remoteAddress ?? '', userAgent: headers['user-agent'] ?? ''
      }
    },
    body, isBase64Encoded: bytes.length > 0 && !textual
  }
}

function writeResult (res: ServerResponse, result: unknown): void {
  // Validate everything before committing headers; invalid results never crash a request.
  if (result === null || typeof result !== 'object' || Array.isArray(result)) throw new Error('invalid response')
  const value = result as Record<string, unknown>
  const status = value.statusCode ?? 200
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 200 || status > 599) throw new Error('invalid status')
  if (value.body !== undefined && typeof value.body !== 'string') throw new Error('invalid body')
  if (value.isBase64Encoded !== undefined && typeof value.isBase64Encoded !== 'boolean') throw new Error('invalid encoding')
  const headers: Record<string, string | string[]> = Object.create(null)
  const cookies: string[] = []
  if (value.headers !== undefined) {
    if (value.headers === null || typeof value.headers !== 'object' || Array.isArray(value.headers)) throw new Error('invalid headers')
    for (const [key, header] of Object.entries(value.headers)) {
      if (!['string', 'number', 'boolean'].includes(typeof header)) throw new Error('invalid header')
      validateHeaderName(key)
      validateHeaderValue(key, String(header))
      const name = key.toLowerCase()
      if (name === 'set-cookie') cookies.push(String(header))
      // Node owns wire framing; do not trust a handler-supplied length or hop headers.
      else if (!['content-length', 'transfer-encoding', 'connection', 'keep-alive', 'upgrade', 'trailer'].includes(name)) headers[name] = String(header)
    }
  }
  if (value.cookies !== undefined) {
    if (!Array.isArray(value.cookies)) throw new Error('invalid cookies')
    for (const cookie of value.cookies) {
      if (typeof cookie !== 'string') throw new Error('invalid cookie')
      validateHeaderValue('set-cookie', cookie)
      cookies.push(cookie)
    }
  }
  if (cookies.length > 0) headers['set-cookie'] = cookies
  const body = value.body as string | undefined ?? ''
  if (value.isBase64Encoded === true && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body)) throw new Error('invalid base64')
  const bytes = Buffer.from(body, value.isBase64Encoded === true ? 'base64' : 'utf8')
  res.writeHead(status, headers)
  res.end(status === 204 || status === 304 ? undefined : bytes)
}

export function createWebFunctionServer (
  handler: WebFunctionHandler,
  options: { maxBodyBytes?: number } = {}
): Server {
  const limit = options.maxBodyBytes ?? defaultMaxBodyBytes
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid maxBodyBytes')
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const { path, query } = parseTarget(req.url ?? '/')
        if (!allowedRoutes.has(`${req.method ?? 'GET'} ${path}`)) {
          req.resume()
          jsonError(res, 404, 'not_found')
          return
        }
        const event = toEvent(req, path, query, await readBody(req, limit))
        const result = await handler(event)
        try {
          writeResult(res, result)
        } catch {
          jsonError(res, 502, 'invalid_response')
        }
      } catch (error) {
        req.resume()
        if (!res.destroyed && !res.headersSent) {
          jsonError(res, error instanceof RequestFailure ? error.status : 500, error instanceof RequestFailure ? error.code : 'internal_error')
        }
      }
    })()
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 10_000
  server.keepAliveTimeout = 5_000
  return server
}
