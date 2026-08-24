import { describe, expect, it } from 'vitest'
import { AesService, SecretService } from '@titvo/shared'

// Task 3.3: "Add titvo-shared npm dep; import AesService directly (no
// reimplementation)". This test proves the dependency is wired correctly
// in THIS repo (module resolution, DI, Node's crypto module all work end
// to end) by round-tripping a value against a known-good vector — the
// same key/plaintext/ciphertext pair locked down by Phase 0's shared
// `aes-test-vectors.json` fixture (titvo-shared/titvo-installer/
// rag-indexer). It intentionally does NOT re-run the full 10-vector
// matrix — that byte-compatibility contract already lives in those three
// repos; duplicating it here would be scope creep for a scaffold batch.
const FIXTURE_KEY_BASE64 = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI='
const FIXTURE_PLAINTEXT = 'a'
const FIXTURE_CIPHERTEXT_BASE64 = '8NodEJVk4kEBCdPeOwLFtA=='

class FakeSecretService extends SecretService {
  // `SecretService.get` is typed `Promise<string>`, but `AesService` itself
  // guards against an `undefined` result at runtime (its own not-found
  // check) — matching that existing (pre-existing, not introduced here)
  // runtime contract requires this cast for the not-found branch.
  async get (secretName: string): Promise<string> {
    return secretName === 'aes-key' ? FIXTURE_KEY_BASE64 : undefined as unknown as string
  }
}

describe('AesService wiring (titvo-shared)', () => {
  it('encrypts a known plaintext to the exact byte-locked ciphertext from the Phase 0 fixture', async () => {
    const aesService = new AesService(new FakeSecretService(), 'aes-key')

    const ciphertext = await aesService.encrypt(FIXTURE_PLAINTEXT)

    expect(ciphertext).toBe(FIXTURE_CIPHERTEXT_BASE64)
  })

  it('decrypts the fixture ciphertext back to the original plaintext', async () => {
    const aesService = new AesService(new FakeSecretService(), 'aes-key')

    const plaintext = await aesService.decrypt(FIXTURE_CIPHERTEXT_BASE64)

    expect(plaintext).toBe(FIXTURE_PLAINTEXT)
  })

  it('throws when the secret cannot be found, never silently encrypting with an undefined key', async () => {
    const aesService = new AesService(new FakeSecretService(), 'missing-key-name')

    await expect(aesService.encrypt('anything')).rejects.toThrow('AES secret not found')
  })
})
