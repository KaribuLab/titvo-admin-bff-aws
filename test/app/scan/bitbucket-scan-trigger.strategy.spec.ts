import { describe, expect, it, vi } from 'vitest'
import { AesService } from '@titvo/shared'
import { RepoItem } from '@core/repo/repo.entity'
import { ConfigRepository } from '@core/config/config.repository'
import { ConfigItem } from '@core/config/config.entity'
import { BitbucketApiClient } from '@core/scan/bitbucket-api.client'
import { BitbucketScanTriggerStrategy } from '@app/scan/bitbucket-scan-trigger.strategy'
import { ConfigMissingError, RepoUrlInvalidError } from '@app/scan/scan-trigger.error'

function buildConfigRepository (items: Record<string, ConfigItem | null>): ConfigRepository {
  return {
    findAll: vi.fn(),
    findById: vi.fn(async (id: string) => items[id] ?? null),
    putNew: vi.fn(),
    update: vi.fn()
  } as unknown as ConfigRepository
}

function buildAesService (decrypt: (value: string) => Promise<string> = vi.fn(async (v: string) => v.replace('ciphertext-', 'plain-'))): AesService {
  return { decrypt, encrypt: vi.fn() } as unknown as AesService
}

function buildBitbucketApiClient (
  resolveBranchCommit: (workspace: string, repoSlug: string, token: string, branch: string) => Promise<string> = vi.fn().mockResolvedValue('c'.repeat(40)),
  fetchProjectKey: (workspace: string, repoSlug: string, token: string) => Promise<string> = vi.fn().mockResolvedValue('PROJ')
): BitbucketApiClient {
  return { resolveBranchCommit, fetchProjectKey } as unknown as BitbucketApiClient
}

const bitbucketRepo: RepoItem = { repositoryId: 'repo-2', name: 'titvo-legacy', url: 'https://bitbucket.org/karibu/titvo-legacy', provider: 'bitbucket' }

const validConfig: Record<string, ConfigItem | null> = {
  bitbucket_api_token: { parameterId: 'bitbucket_api_token', value: 'ciphertext-token', isSecret: true }
}

describe('BitbucketScanTriggerStrategy', () => {
  it('supports only the bitbucket provider', () => {
    const strategy = new BitbucketScanTriggerStrategy(buildConfigRepository(validConfig), buildAesService(), buildBitbucketApiClient())
    expect(strategy.supports('bitbucket')).toBe(true)
    expect(strategy.supports('github')).toBe(false)
    expect(strategy.supports(undefined)).toBe(false)
  })

  it('throws RepoUrlInvalidError when the repo has no url on record', async () => {
    const strategy = new BitbucketScanTriggerStrategy(buildConfigRepository(validConfig), buildAesService(), buildBitbucketApiClient())

    await expect(strategy.buildRunScanPayload({ repositoryId: 'repo-2', provider: 'bitbucket' }, 'main')).rejects.toThrow(RepoUrlInvalidError)
  })

  it('throws RepoUrlInvalidError for a non-bitbucket.org url on a bitbucket-tagged repo', async () => {
    const strategy = new BitbucketScanTriggerStrategy(buildConfigRepository(validConfig), buildAesService(), buildBitbucketApiClient())

    await expect(strategy.buildRunScanPayload({ repositoryId: 'repo-2', provider: 'bitbucket', url: 'https://github.com/karibu/titvo-legacy' }, 'main')).rejects.toThrow(RepoUrlInvalidError)
  })

  it('throws ConfigMissingError naming bitbucket_api_token when it is not set', async () => {
    const strategy = new BitbucketScanTriggerStrategy(buildConfigRepository({ bitbucket_api_token: null }), buildAesService(), buildBitbucketApiClient())

    const error = await strategy.buildRunScanPayload(bitbucketRepo, 'main').catch(e => e)
    expect(error).toBeInstanceOf(ConfigMissingError)
    expect((error as ConfigMissingError).parameterId).toBe('bitbucket_api_token')
  })

  it('does NOT require a default-assignee-style config parameter (bitbucket contract has no assignee field)', async () => {
    // Only bitbucket_api_token in the config repo — if the strategy required
    // anything else, this would throw ConfigMissingError for that other key.
    const strategy = new BitbucketScanTriggerStrategy(buildConfigRepository(validConfig), buildAesService(), buildBitbucketApiClient())

    await expect(strategy.buildRunScanPayload(bitbucketRepo, 'main')).resolves.toBeDefined()
  })

  it('decrypts the token, resolves workspace/repo/commit/project-key, and builds the exact source:"bitbucket" payload', async () => {
    const decrypt = vi.fn(async (value: string) => value.replace('ciphertext-', 'plain-'))
    const resolveBranchCommit = vi.fn().mockResolvedValue('d'.repeat(40))
    const fetchProjectKey = vi.fn().mockResolvedValue('TVO')
    const strategy = new BitbucketScanTriggerStrategy(buildConfigRepository(validConfig), buildAesService(decrypt), buildBitbucketApiClient(resolveBranchCommit, fetchProjectKey))

    const payload = await strategy.buildRunScanPayload(bitbucketRepo, 'develop')

    expect(resolveBranchCommit).toHaveBeenCalledWith('karibu', 'titvo-legacy', 'plain-token', 'develop')
    expect(fetchProjectKey).toHaveBeenCalledWith('karibu', 'titvo-legacy', 'plain-token')
    expect(payload).toEqual({
      source: 'bitbucket',
      args: {
        repository_url: 'https://bitbucket.org/karibu/titvo-legacy',
        bitbucket_workspace: 'karibu',
        bitbucket_repo_slug: 'titvo-legacy',
        bitbucket_project_key: 'TVO',
        bitbucket_commit: 'd'.repeat(40),
        bitbucket_branch: 'develop'
      }
    })
  })

  it('parses an SSH-form bitbucket url the same way', async () => {
    const resolveBranchCommit = vi.fn().mockResolvedValue('e'.repeat(40))
    const fetchProjectKey = vi.fn().mockResolvedValue('TVO')
    const strategy = new BitbucketScanTriggerStrategy(buildConfigRepository(validConfig), buildAesService(), buildBitbucketApiClient(resolveBranchCommit, fetchProjectKey))

    await strategy.buildRunScanPayload({ repositoryId: 'repo-2', provider: 'bitbucket', url: 'git@bitbucket.org:karibu/titvo-legacy.git' }, 'main')

    expect(resolveBranchCommit).toHaveBeenCalledWith('karibu', 'titvo-legacy', expect.any(String), 'main')
  })

  it('propagates a branch-resolution failure from the Bitbucket API client', async () => {
    const strategy = new BitbucketScanTriggerStrategy(buildConfigRepository(validConfig), buildAesService(), buildBitbucketApiClient(vi.fn().mockRejectedValue(new Error('branch not found'))))

    await expect(strategy.buildRunScanPayload(bitbucketRepo, 'no-such-branch')).rejects.toThrow('branch not found')
  })

  it('propagates a project-key lookup failure from the Bitbucket API client', async () => {
    const strategy = new BitbucketScanTriggerStrategy(
      buildConfigRepository(validConfig),
      buildAesService(),
      buildBitbucketApiClient(vi.fn().mockResolvedValue('f'.repeat(40)), vi.fn().mockRejectedValue(new Error('project key not found')))
    )

    await expect(strategy.buildRunScanPayload(bitbucketRepo, 'main')).rejects.toThrow('project key not found')
  })
})
