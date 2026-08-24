/** Thrown when `POST /api/admin/config` targets a `parameter_id` that already exists (spec: "Add with existing key"). */
export class ConfigAlreadyExistsError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'ConfigAlreadyExistsError'
  }
}

/** Thrown when `PUT /api/admin/config/:id` targets a `parameter_id` that does not exist. */
export class ConfigNotFoundError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'ConfigNotFoundError'
  }
}

/** Thrown when an update request's `is_secret` disagrees with the existing entry's resolved type (design: runtime-decryption-break guard). */
export class ConfigTypeMismatchError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'ConfigTypeMismatchError'
  }
}

/**
 * Thrown whenever the AES key/Secrets Manager cannot be reached — on save
 * (never persist plaintext under a secret path) AND during list/get-time
 * `is_secret` inference (never silently mislabel a secret as a plaintext
 * parameter because the key was temporarily unreachable).
 */
export class EncryptionUnavailableError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'EncryptionUnavailableError'
  }
}
