import type { Context } from 'aws-lambda'
import { createWebFunctionServer, parseHttpEndpoint } from './adapter'

// Validate the runtime contract before bootstrapping Nest or its dependencies.
const endpoint = parseHttpEndpoint(process.env.AWS_LAMBDA_HTTP_ENDPOINT)
const { handler } = await import(/* webpackMode: "eager" */ '../entrypoint')
const server = createWebFunctionServer(async event => await handler(event, {
  awsRequestId: event.requestContext.requestId,
  functionName: process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'web-functions-local',
  functionVersion: process.env.AWS_LAMBDA_FUNCTION_VERSION ?? '$LATEST',
  invokedFunctionArn: '', memoryLimitInMB: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE ?? '',
  logGroupName: '', logStreamName: '', callbackWaitsForEmptyEventLoop: false,
  getRemainingTimeInMillis: () => 30_000,
  done: () => {}, fail: () => {}, succeed: () => {}
} as Context, () => {}))

server.on('error', () => {
  // Do not print request data, environment variables, or exception details.
  console.error('[web-functions] HTTP listener failed')
  process.exitCode = 1
})
server.listen(endpoint.port, endpoint.host)

// Lambda may terminate the process; allow in-flight responses to finish first.
process.once('SIGTERM', () => {
  server.close(() => { process.exitCode = 0 })
  server.closeIdleConnections()
  setTimeout(() => { server.closeAllConnections() }, 5000).unref()
})
