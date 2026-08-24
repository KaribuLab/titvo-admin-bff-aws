/**
 * Thrown when `POST /api/admin/api-keys/:id/revoke` targets the last
 * remaining ACTIVE api key (design risk resolution #1, obs #884 item 1 —
 * mirrors D6's last-admin invariant: never let the platform lock itself
 * out of API access).
 */
export class LastActiveKeyError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'LastActiveKeyError'
  }
}
