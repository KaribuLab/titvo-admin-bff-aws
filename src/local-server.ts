/**
 * Local-only dev server. Wraps the real Lambda `handler` (entrypoint.ts)
 * behind a plain Node HTTP server so it can be exercised with a normal
 * browser/curl instead of a real API Gateway invocation.
 *
 * Not part of the Lambda bundle (`npm run build`/rspack never touches this
 * file) and not used in production — see docs/local-development.md at the
 * repo root for how this fits into the local-testing setup (LocalStack +
 * this server + the SPA's Vite dev-server proxy).
 *
 * Run with: npm run dev
 */
import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Context, Callback } from 'aws-lambda'

try {
  process.loadEnvFile('.env.local')
} catch (error) {
  console.warn('[local-server] No .env.local found — copy .env.local.example to .env.local first. Continuing with process env only.')
}

// Imported AFTER env vars are loaded: entrypoint.ts reads process.env at
// module-init time (top-level `await initApp()`), so the import order here
// matters.
const { handler } = await import('./entrypoint')

const PORT = Number(process.env.PORT ?? 3001)

async function readBody (req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function toHeaderMap (req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') {
      headers[key] = value
    } else if (Array.isArray(value)) {
      headers[key] = value.join(', ')
    }
  }
  return headers
}

function toEvent (req: IncomingMessage, rawBody: string): APIGatewayProxyEventV2 {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `localhost:${PORT}`}`)
  const headers = toHeaderMap(req)

  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: url.pathname,
    rawQueryString: url.search.replace(/^\?/, ''),
    headers,
    requestContext: {
      http: {
        method: req.method ?? 'GET',
        path: url.pathname,
        protocol: 'HTTP/1.1',
        sourceIp: req.socket.remoteAddress ?? '',
        userAgent: headers['user-agent'] ?? ''
      }
    },
    body: rawBody.length > 0 ? rawBody : undefined,
    isBase64Encoded: false
  } as unknown as APIGatewayProxyEventV2
}

function writeResult (res: ServerResponse, result: APIGatewayProxyStructuredResultV2 | undefined): void {
  if (result === undefined) {
    res.writeHead(204)
    res.end()
    return
  }
  res.writeHead(result.statusCode ?? 200, result.headers as Record<string, string> ?? {})
  res.end(result.body ?? '')
}

const server = createServer((req, res) => {
  readBody(req)
    .then(async (rawBody) => {
      const event = toEvent(req, rawBody)
      const noop: Callback = () => {}
      const result = await handler(event, {} as Context, noop)
      writeResult(res, result as APIGatewayProxyStructuredResultV2 | undefined)
    })
    .catch((error) => {
      console.error('[local-server] Unhandled error', error)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'internal_error' }))
    })
})

server.listen(PORT, () => {
  console.log(`[local-server] titvo-admin-bff-aws listening on http://localhost:${PORT}`)
  console.log(`[local-server] AWS_STAGE=${process.env.AWS_STAGE ?? '(unset)'} AWS_ENDPOINT=${process.env.AWS_ENDPOINT ?? '(unset)'}`)
})
