import { describe, expect, it } from 'vitest'
import { handleHealth } from '@infrastructure/health/health.handler'

describe('handleHealth', () => {
  it('returns 200 {status:"ok"} without requiring authentication', async () => {
    const result = await handleHealth()

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body as string)).toEqual({ status: 'ok' })
  })
})
