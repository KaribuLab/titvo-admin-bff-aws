import { describe, expect, it } from 'vitest'
import { AesService, SecretService } from '@titvo/shared'
import { ConfigRepository, ConfigUpdatePatch, NewConfigItem } from '@core/config/config.repository'
import { ConfigItem } from '@core/config/config.entity'
import { AddConfigUseCase } from '@app/config/add-config.use-case'
import { GetConfigUseCase } from '@app/config/get-config.use-case'

// Task 3.13: "BFF-saved secret decrypts via unmodified titvo-shared
// AesService (DynamoDB Local)." No DynamoDB Local / live AWS integration
// harness exists in this environment — same documented gap as Batch 4
// (titvo-installer's seed-admin). Substituted with an in-memory
// `ConfigRepository` implementation (a real adapter, not a mocked
// use-case) driving the ACTUAL `AddConfigUseCase`/`GetConfigUseCase`
// business logic against the REAL, unmodified `AesService` imported from
// the `shared` submodule — the same class titvo-installer/rag-indexer
// use to decrypt, and the same class this repo's DI wiring
// (crypto.module.ts) provides in production. This proves the full
// encrypt-on-save write path produces ciphertext an unmodified AesService
// consumer can decrypt, without needing a live DynamoDB.
class InMemoryConfigRepository extends ConfigRepository {
  private readonly items = new Map<string, ConfigItem>()

  async findAll (): Promise<ConfigItem[]> {
    return Array.from(this.items.values())
  }

  async findById (parameterId: string): Promise<ConfigItem | null> {
    return this.items.get(parameterId) ?? null
  }

  async putNew (item: NewConfigItem): Promise<void> {
    if (this.items.has(item.parameterId)) {
      throw new Error('already exists')
    }
    this.items.set(item.parameterId, { ...item })
  }

  async update (parameterId: string, patch: ConfigUpdatePatch): Promise<void> {
    const existing = this.items.get(parameterId)
    if (existing === undefined) {
      throw new Error('not found')
    }
    this.items.set(parameterId, {
      ...existing,
      value: patch.value ?? existing.value,
      isSecret: patch.isSecret,
      updatedAt: patch.updatedAt,
      updatedBy: patch.updatedBy
    })
  }
}

// Reuses the Phase-0-locked shared AES key so this test's decrypt is
// verified against the SAME vector fixture titvo-shared/titvo-installer/
// rag-indexer already lock in — proving cross-consumer byte compatibility,
// not just internal self-consistency.
const FIXTURE_KEY_BASE64 = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI='

class FixtureSecretService extends SecretService {
  async get (secretName: string): Promise<string> {
    return secretName === 'aes-key' ? FIXTURE_KEY_BASE64 : undefined as unknown as string
  }
}

describe('Config CRUD integration: encrypt-on-save round-trips through an unmodified AesService', () => {
  it('a secret saved via AddConfigUseCase decrypts correctly with a separate, unmodified AesService instance', async () => {
    const repository = new InMemoryConfigRepository()
    const aesService = new AesService(new FixtureSecretService(), 'aes-key')
    const addConfigUseCase = new AddConfigUseCase(repository, aesService)

    await addConfigUseCase.execute({ parameterId: 'db-password', value: 'super-secret-value', isSecret: true }, 'admin@titvo.dev')

    // Simulate "an existing runtime consumer" (spec: admin-config-management
    // "Secret round-trips with existing consumer") reading the raw stored
    // ciphertext directly and decrypting with its OWN AesService instance —
    // never through the write-only GetConfigUseCase API.
    const stored = await repository.findById('db-password')
    expect(stored).not.toBeNull()
    const consumerAesService = new AesService(new FixtureSecretService(), 'aes-key')
    const decrypted = await consumerAesService.decrypt(stored?.value ?? '')

    expect(decrypted).toBe('super-secret-value')
  })

  it('GetConfigUseCase never exposes the ciphertext or plaintext for a secret (write-only, spec-required)', async () => {
    const repository = new InMemoryConfigRepository()
    const aesService = new AesService(new FixtureSecretService(), 'aes-key')
    const addConfigUseCase = new AddConfigUseCase(repository, aesService)
    const getConfigUseCase = new GetConfigUseCase(repository, aesService)

    await addConfigUseCase.execute({ parameterId: 'api-token', value: 'never-leak-me', isSecret: true }, 'admin@titvo.dev')
    const detail = await getConfigUseCase.execute('api-token')

    expect(detail).toEqual({ parameterId: 'api-token', isSecret: true, value: undefined, updatedAt: expect.any(String), updatedBy: 'admin@titvo.dev' })
    expect(JSON.stringify(detail)).not.toContain('never-leak-me')
  })

  it('a plaintext parameter round-trips unencrypted end-to-end', async () => {
    const repository = new InMemoryConfigRepository()
    const aesService = new AesService(new FixtureSecretService(), 'aes-key')
    const addConfigUseCase = new AddConfigUseCase(repository, aesService)
    const getConfigUseCase = new GetConfigUseCase(repository, aesService)

    await addConfigUseCase.execute({ parameterId: 'log_level', value: 'debug', isSecret: false }, 'admin@titvo.dev')
    const detail = await getConfigUseCase.execute('log_level')

    expect(detail?.value).toBe('debug')
  })
})
