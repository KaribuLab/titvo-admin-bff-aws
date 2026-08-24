/**
 * Raw item as read from the `repository` table. Only `repositoryId` (the
 * table's hash key) is structurally guaranteed. Every other field is
 * best-effort/optional — design risk resolution #3 (obs #884 item 3):
 * this table's only writer is the external, not-vendored `@titvo/trigger`
 * package, so its exact shape cannot be verified from this checkout.
 * `userId` is the one other field confirmed by the existing
 * `user_id_gsi`. The mapper in `infrastructure/repo/repo.dynamo.ts` must
 * stay tolerant of missing/unexpected attributes — never throw.
 */
export interface RepoItem {
  repositoryId: string
  userId?: string
  name?: string
  url?: string
  provider?: string
  createdAt?: string
}
