import { ApiKeyEntity } from '@titvo/auth'

/**
 * Counts active keys in a snapshot. "Active" per design D5 (titvo-auth
 * WU2): any key whose `status` is not explicitly `'revoked'` (missing
 * means active — every installer-minted key predates this attribute).
 *
 * Pure function, mirrors titvo-auth's `countActiveAdmins` shape — fully
 * unit-testable without any database.
 * @param keys Snapshot of API keys to evaluate
 * @returns Number of keys whose status is not `'revoked'`
 */
export function countActiveApiKeys (keys: ApiKeyEntity[]): number {
  return keys.filter((k) => k.status !== 'revoked').length
}

/**
 * Pure predicate for the last-active-key invariant (design risk
 * resolution #1, obs #884 item 1): would revoking `targetKeyId` leave the
 * platform with zero active API keys? Mirrors the last-admin invariant's
 * shape (D6) — same rationale, never let the platform lock itself out of
 * API access.
 *
 * If the target is not currently active (already revoked, or not found),
 * revoking it cannot remove an active key, so this always returns
 * `false` — callers still need their own idempotency handling for an
 * already-revoked key, this guard only protects the invariant.
 * @param keys Snapshot of API keys (a Scan result in production)
 * @param targetKeyId ID of the key being revoked
 * @returns `true` if revoking the target would leave zero active keys
 */
export function wouldViolateLastActiveKeyInvariant (keys: ApiKeyEntity[], targetKeyId: string): boolean {
  const target = keys.find((k) => k.keyId === targetKeyId)

  if (target === undefined || target.status === 'revoked') {
    return false
  }

  const remainingKeys = keys.filter((k) => k.keyId !== targetKeyId)
  return countActiveApiKeys(remainingKeys) === 0
}
