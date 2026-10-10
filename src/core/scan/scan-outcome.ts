/** Derive execution only from measured coverage, independently of security findings. */
export function executionStatusFromResult (value: unknown): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const data = value as Record<string, unknown>
  const coverage = data.coverage !== null && typeof data.coverage === 'object' ? data.coverage as Record<string, unknown> : {}
  const metrics = data.metrics !== null && typeof data.metrics === 'object' ? data.metrics as Record<string, unknown> : {}
  if (coverage.complete === true) return 'COMPLETED'
  if (coverage.complete === false) return metrics.completed_batches === 0 && typeof data.error === 'string' && data.error !== '' ? 'FAILED' : 'INCOMPLETE'
  return undefined
}
