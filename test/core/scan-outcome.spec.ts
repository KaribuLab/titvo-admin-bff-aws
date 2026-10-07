import { describe, expect, it } from 'vitest'
import { executionStatusFromResult } from '@core/scan/scan-outcome'

describe('independent scan execution', () => {
  it.each([
    [{ status: 'FAILED', coverage: { complete: true }, issues_count: 2 }, 'COMPLETED'],
    [{ coverage: { complete: false }, metrics: { completed_batches: 3 }, error: 'Batch error' }, 'INCOMPLETE'],
    [{ coverage: { complete: false }, metrics: { completed_batches: 0 }, error: 'Retrieval error' }, 'FAILED'],
    [{ coverage: { complete: true }, error: 'Diagnostic' }, 'COMPLETED'],
    [{ status: 'FAILED', issues_count: 2 }, undefined],
    [null, undefined]
  ])('derives coverage without reinterpreting security status %#', (result, expected) => {
    expect(executionStatusFromResult(result)).toBe(expected)
  })
})
