import { ConfigItem } from './config.entity'

export interface NewConfigItem {
  parameterId: string
  value: string
  isSecret: boolean
  updatedAt: string
  updatedBy: string
}

export interface ConfigUpdatePatch {
  value?: string
  isSecret: boolean
  updatedAt: string
  updatedBy: string
}

export abstract class ConfigRepository {
  abstract findAll (): Promise<ConfigItem[]>
  abstract findById (parameterId: string): Promise<ConfigItem | null>
  /** Must reject with `ConfigAlreadyExistsError` (see `config.error.ts`) when `parameterId` already exists — no silent clobber. */
  abstract putNew (item: NewConfigItem): Promise<void>
  abstract update (parameterId: string, patch: ConfigUpdatePatch): Promise<void>
}
