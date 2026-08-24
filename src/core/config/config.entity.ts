/**
 * Raw config-table item as read from `tvo-security-scan-parameter-prod`.
 * `isSecret` is `undefined` for items written by the CLI wizard before
 * this feature existed (design: "Items lacking `is_secret` are treated
 * as secrets iff decrypt succeeds") — callers must resolve it via
 * `resolveIsSecret` before exposing metadata, never assume `false`.
 */
export interface ConfigItem {
  parameterId: string
  value: string
  isSecret: boolean | undefined
  updatedAt?: string
  updatedBy?: string
}

/** Metadata-only shape for list responses — `value` is never included (write-only secrets). */
export interface ConfigListItem {
  parameterId: string
  isSecret: boolean
  updatedAt?: string
  updatedBy?: string
}

/** Detail shape for a single entry — `value` present only when `isSecret === false`. */
export interface ConfigDetail {
  parameterId: string
  isSecret: boolean
  value?: string
  updatedAt?: string
  updatedBy?: string
}
