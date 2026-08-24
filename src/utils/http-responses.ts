import { APIGatewayProxyStructuredResultV2 } from 'aws-lambda'

export const JSON_HEADERS = { 'Content-Type': 'application/json' }

export function jsonResponse (statusCode: number, body: unknown, extraHeaders: Record<string, string> = {}): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { ...JSON_HEADERS, ...extraHeaders },
    body: JSON.stringify(body)
  }
}
