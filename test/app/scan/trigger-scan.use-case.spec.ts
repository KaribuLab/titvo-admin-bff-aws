import { describe, expect, it, vi } from 'vitest'
import { AesService } from '@titvo/shared'
import { ApiKeyEntity, ValidateApiKeyUseCase } from '@titvo/auth'
import { RepoRepository } from '@core/repo/repo.repository'
import { RepoItem } from '@core/repo/repo.entity'
import { ConfigRepository } from '@core/config/config.repository'
import { ConfigItem } from '@core/config/config.entity'
import { TaskTriggerClient, RunScanPayload } from '@core/scan/task-trigger.client'
import { ScanTriggerStrategy } from '@core/scan/scan-trigger-strategy'
import { GithubScanTriggerStrategy } from '@app/scan/github-scan-trigger.strategy'
import { BitbucketScanTriggerStrategy } from '@app/scan/bitbucket-scan-trigger.strategy'
import { TriggerScanUseCase } from '@app/scan/trigger-scan.use-case'
import { computeExpectedRepositoryId } from '@app/scan/compute-expected-repository-id'
import { RepoNotFoundError, UnsupportedProviderError, ConfigMissingError } from '@app/scan/scan-trigger.error'

function buildRepoRepository (repos: RepoItem[]): RepoRepository {
  return { findAll: vi.fn().mockResolvedValue(repos) } as unknown as RepoRepository
}

function buildConfigRepository (items: Record<string, ConfigItem | null>): ConfigRepository {
  return {
    findAll: vi.fn(),
    findById: vi.fn(async (id: string) => items[id] ?? null),
    putNew: vi.fn(),
    update: vi.fn()
  } as unknown as ConfigRepository
}

function buildAesService (): AesService {
  return { decrypt: vi.fn(async (v: string) => `plain:${v}`), encrypt: vi.fn() } as unknown as AesService
}

function buildTaskTriggerClient (runScan: (apiKey: string, payload: RunScanPayload) => Promise<{ message: string, scanId: string }> = vi.fn().mockResolvedValue({ message: 'Scan starting', scanId: 'scan-123' })): TaskTriggerClient {
  return { runScan } as unknown as TaskTriggerClient
}

/** Defaults to an entity whose userId is irrelevant — most tests use fake-strategy payloads with no `github_repo_name`/bitbucket slug fields, so `deriveRepositorySlug` returns undefined and this is never even called. */
function buildValidateApiKeyUseCase (execute: (apiKey: string) => Promise<ApiKeyEntity> = vi.fn().mockResolvedValue({ keyId: 'k1', userId: 'user-x', apiKey: 'hashed' })): ValidateApiKeyUseCase {
  return { execute } as unknown as ValidateApiKeyUseCase
}

/** A minimal fake strategy — keeps this suite focused on the use-case's OWN job (repo lookup, provider dispatch, the shared service key, the actual /run-scan call), not each provider's internal payload-building details (covered by github-scan-trigger.strategy.spec.ts / bitbucket-scan-trigger.strategy.spec.ts). */
function buildFakeStrategy (provider: string, payload: RunScanPayload = { source: provider, args: {} }): ScanTriggerStrategy & { buildRunScanPayload: ReturnType<typeof vi.fn> } {
  return {
    supports: (candidate: string | undefined) => candidate === provider,
    buildRunScanPayload: vi.fn().mockResolvedValue(payload)
  }
}

const githubRepo: RepoItem = { repositoryId: 'repo-1', name: 'titvo-rag-indexer', url: 'https://github.com/KaribuLab/titvo-rag-indexer', provider: 'github' }
const bitbucketRepo: RepoItem = { repositoryId: 'repo-2', name: 'titvo-legacy', url: 'https://bitbucket.org/karibu/titvo-legacy', provider: 'bitbucket' }

const validConfig: Record<string, ConfigItem | null> = {
  bff_scan_trigger_api_key: { parameterId: 'bff_scan_trigger_api_key', value: 'ciphertext-key', isSecret: true }
}

describe('TriggerScanUseCase', () => {
  it('throws RepoNotFoundError when the repo does not exist', async () => {
    const useCase = new TriggerScanUseCase(
      buildRepoRepository([]),
      buildConfigRepository(validConfig),
      buildAesService(),
      buildTaskTriggerClient(),
      buildValidateApiKeyUseCase(),
      buildFakeStrategy('github') as unknown as GithubScanTriggerStrategy,
      buildFakeStrategy('bitbucket') as unknown as BitbucketScanTriggerStrategy
    )

    await expect(useCase.execute({ repositoryId: 'missing', branch: 'main' })).rejects.toThrow(RepoNotFoundError)
  })

  it('throws UnsupportedProviderError when no strategy supports the repo provider, never reading config or calling out', async () => {
    const configRepository = buildConfigRepository(validConfig)
    const taskTriggerClient = buildTaskTriggerClient()
    const githubStrategy = buildFakeStrategy('github')
    const bitbucketStrategy = buildFakeStrategy('bitbucket')
    const useCase = new TriggerScanUseCase(
      buildRepoRepository([{ repositoryId: 'repo-1', provider: 'gitlab', url: 'https://gitlab.com/a/b' }]),
      configRepository,
      buildAesService(),
      taskTriggerClient,
      buildValidateApiKeyUseCase(),
      githubStrategy as unknown as GithubScanTriggerStrategy,
      bitbucketStrategy as unknown as BitbucketScanTriggerStrategy
    )

    await expect(useCase.execute({ repositoryId: 'repo-1', branch: 'main' })).rejects.toThrow(UnsupportedProviderError)
    expect(configRepository.findById).not.toHaveBeenCalled()
    expect(githubStrategy.buildRunScanPayload).not.toHaveBeenCalled()
    expect(bitbucketStrategy.buildRunScanPayload).not.toHaveBeenCalled()
    expect(taskTriggerClient.runScan).not.toHaveBeenCalled()
  })

  it('throws UnsupportedProviderError for a repo with no provider on record', async () => {
    const useCase = new TriggerScanUseCase(
      buildRepoRepository([{ repositoryId: 'repo-1', url: 'https://github.com/a/b' }]),
      buildConfigRepository(validConfig),
      buildAesService(),
      buildTaskTriggerClient(),
      buildValidateApiKeyUseCase(),
      buildFakeStrategy('github') as unknown as GithubScanTriggerStrategy,
      buildFakeStrategy('bitbucket') as unknown as BitbucketScanTriggerStrategy
    )

    await expect(useCase.execute({ repositoryId: 'repo-1', branch: 'main' })).rejects.toThrow(UnsupportedProviderError)
  })

  it('dispatches a github repo to the github strategy, and never touches the bitbucket strategy', async () => {
    const githubStrategy = buildFakeStrategy('github', { source: 'github', args: { github_branch: 'main' } })
    const bitbucketStrategy = buildFakeStrategy('bitbucket')
    const runScan = vi.fn().mockResolvedValue({ message: 'Scan starting', scanId: 'scan-gh' })
    const useCase = new TriggerScanUseCase(
      buildRepoRepository([githubRepo]),
      buildConfigRepository(validConfig),
      buildAesService(),
      buildTaskTriggerClient(runScan),
      buildValidateApiKeyUseCase(),
      githubStrategy as unknown as GithubScanTriggerStrategy,
      bitbucketStrategy as unknown as BitbucketScanTriggerStrategy
    )

    const result = await useCase.execute({ repositoryId: 'repo-1', branch: 'main' })

    expect(githubStrategy.buildRunScanPayload).toHaveBeenCalledWith(githubRepo, 'main')
    expect(bitbucketStrategy.buildRunScanPayload).not.toHaveBeenCalled()
    expect(runScan).toHaveBeenCalledWith('plain:ciphertext-key', { source: 'github', args: { github_branch: 'main' } })
    expect(result).toEqual({ scanId: 'scan-gh', repositoryIdWarning: undefined })
  })

  it('adds scan_mode to the payload args when provided (full scan toggle), leaving it unset by default', async () => {
    const githubStrategy = buildFakeStrategy('github', { source: 'github', args: { github_branch: 'main' } })
    const runScan = vi.fn().mockResolvedValue({ message: 'Scan starting', scanId: 'scan-gh' })
    const useCase = new TriggerScanUseCase(
      buildRepoRepository([githubRepo]),
      buildConfigRepository(validConfig),
      buildAesService(),
      buildTaskTriggerClient(runScan),
      buildValidateApiKeyUseCase(),
      githubStrategy as unknown as GithubScanTriggerStrategy,
      buildFakeStrategy('bitbucket') as unknown as BitbucketScanTriggerStrategy
    )

    await useCase.execute({ repositoryId: 'repo-1', branch: 'main', scanMode: 'full' })

    expect(runScan).toHaveBeenCalledWith('plain:ciphertext-key', { source: 'github', args: { github_branch: 'main', scan_mode: 'full' } })
  })

  it('dispatches a bitbucket repo to the bitbucket strategy, and never touches the github strategy', async () => {
    const githubStrategy = buildFakeStrategy('github')
    const bitbucketStrategy = buildFakeStrategy('bitbucket', { source: 'bitbucket', args: { bitbucket_branch: 'develop' } })
    const runScan = vi.fn().mockResolvedValue({ message: 'Scan starting', scanId: 'scan-bb' })
    const useCase = new TriggerScanUseCase(
      buildRepoRepository([bitbucketRepo]),
      buildConfigRepository(validConfig),
      buildAesService(),
      buildTaskTriggerClient(runScan),
      buildValidateApiKeyUseCase(),
      githubStrategy as unknown as GithubScanTriggerStrategy,
      bitbucketStrategy as unknown as BitbucketScanTriggerStrategy
    )

    const result = await useCase.execute({ repositoryId: 'repo-2', branch: 'develop' })

    expect(bitbucketStrategy.buildRunScanPayload).toHaveBeenCalledWith(bitbucketRepo, 'develop')
    expect(githubStrategy.buildRunScanPayload).not.toHaveBeenCalled()
    expect(runScan).toHaveBeenCalledWith('plain:ciphertext-key', { source: 'bitbucket', args: { bitbucket_branch: 'develop' } })
    expect(result).toEqual({ scanId: 'scan-bb', repositoryIdWarning: undefined })
  })

  it('throws ConfigMissingError naming bff_scan_trigger_api_key when it is not set (shared across both providers)', async () => {
    const useCase = new TriggerScanUseCase(
      buildRepoRepository([githubRepo]),
      buildConfigRepository({ bff_scan_trigger_api_key: null }),
      buildAesService(),
      buildTaskTriggerClient(),
      buildValidateApiKeyUseCase(),
      buildFakeStrategy('github') as unknown as GithubScanTriggerStrategy,
      buildFakeStrategy('bitbucket') as unknown as BitbucketScanTriggerStrategy
    )

    const error = await useCase.execute({ repositoryId: 'repo-1', branch: 'main' }).catch(e => e)
    expect(error).toBeInstanceOf(ConfigMissingError)
    expect((error as ConfigMissingError).parameterId).toBe('bff_scan_trigger_api_key')
  })

  it('propagates a strategy failure (e.g. branch resolution) without calling task-trigger', async () => {
    const githubStrategy = buildFakeStrategy('github')
    githubStrategy.buildRunScanPayload.mockRejectedValueOnce(new Error('branch not found'))
    const taskTriggerClient = buildTaskTriggerClient()
    const useCase = new TriggerScanUseCase(
      buildRepoRepository([githubRepo]),
      buildConfigRepository(validConfig),
      buildAesService(),
      taskTriggerClient,
      buildValidateApiKeyUseCase(),
      githubStrategy as unknown as GithubScanTriggerStrategy,
      buildFakeStrategy('bitbucket') as unknown as BitbucketScanTriggerStrategy
    )

    await expect(useCase.execute({ repositoryId: 'repo-1', branch: 'no-such-branch' })).rejects.toThrow('branch not found')
    expect(taskTriggerClient.runScan).not.toHaveBeenCalled()
  })

  it('propagates a task-trigger call failure', async () => {
    const useCase = new TriggerScanUseCase(
      buildRepoRepository([githubRepo]),
      buildConfigRepository(validConfig),
      buildAesService(),
      buildTaskTriggerClient(vi.fn().mockRejectedValue(new Error('upstream down'))),
      buildValidateApiKeyUseCase(),
      buildFakeStrategy('github') as unknown as GithubScanTriggerStrategy,
      buildFakeStrategy('bitbucket') as unknown as BitbucketScanTriggerStrategy
    )

    await expect(useCase.execute({ repositoryId: 'repo-1', branch: 'main' })).rejects.toThrow('upstream down')
  })

  describe('repositoryId mismatch detection', () => {
    it('adds no warning when the service key owner produces the SAME repositoryId the repo already has', async () => {
      const expectedId = computeExpectedRepositoryId('user-x', 'KaribuLab/titvo-rag-indexer')
      const repo: RepoItem = { ...githubRepo, repositoryId: expectedId }
      const githubStrategy = buildFakeStrategy('github', { source: 'github', args: { github_repo_name: 'KaribuLab/titvo-rag-indexer' } })
      const runScan = vi.fn().mockResolvedValue({ message: 'Scan starting', scanId: 'scan-gh' })
      const useCase = new TriggerScanUseCase(
        buildRepoRepository([repo]),
        buildConfigRepository(validConfig),
        buildAesService(),
        buildTaskTriggerClient(runScan),
        buildValidateApiKeyUseCase(vi.fn().mockResolvedValue({ keyId: 'k1', userId: 'user-x', apiKey: 'hashed' })),
        githubStrategy as unknown as GithubScanTriggerStrategy,
        buildFakeStrategy('bitbucket') as unknown as BitbucketScanTriggerStrategy
      )

      const result = await useCase.execute({ repositoryId: expectedId, branch: 'main' })

      expect(result.repositoryIdWarning).toBeUndefined()
      expect(runScan).toHaveBeenCalled()
    })

    it('adds a warning (but still triggers the scan) when the service key owner would produce a DIFFERENT repositoryId', async () => {
      // repo's existing repositoryId was produced by a different user's key ('user-original')
      const existingId = computeExpectedRepositoryId('user-original', 'KaribuLab/titvo-rag-indexer')
      const repo: RepoItem = { ...githubRepo, repositoryId: existingId }
      const githubStrategy = buildFakeStrategy('github', { source: 'github', args: { github_repo_name: 'KaribuLab/titvo-rag-indexer' } })
      const runScan = vi.fn().mockResolvedValue({ message: 'Scan starting', scanId: 'scan-gh' })
      const useCase = new TriggerScanUseCase(
        buildRepoRepository([repo]),
        buildConfigRepository(validConfig),
        buildAesService(),
        buildTaskTriggerClient(runScan),
        buildValidateApiKeyUseCase(vi.fn().mockResolvedValue({ keyId: 'k1', userId: 'user-different', apiKey: 'hashed' })),
        githubStrategy as unknown as GithubScanTriggerStrategy,
        buildFakeStrategy('bitbucket') as unknown as BitbucketScanTriggerStrategy
      )

      const result = await useCase.execute({ repositoryId: existingId, branch: 'main' })

      expect(result.scanId).toBe('scan-gh')
      expect(result.repositoryIdWarning).toBeDefined()
      expect(result.repositoryIdWarning).toContain('bff_scan_trigger_api_key')
      // Not blocking — the scan still runs.
      expect(runScan).toHaveBeenCalled()
    })

    it('derives the bitbucket slug from workspace+repo_slug for the same check', async () => {
      const existingId = computeExpectedRepositoryId('user-original', 'karibu/titvo-legacy')
      const repo: RepoItem = { ...bitbucketRepo, repositoryId: existingId }
      const bitbucketStrategy = buildFakeStrategy('bitbucket', { source: 'bitbucket', args: { bitbucket_workspace: 'karibu', bitbucket_repo_slug: 'titvo-legacy' } })
      const useCase = new TriggerScanUseCase(
        buildRepoRepository([repo]),
        buildConfigRepository(validConfig),
        buildAesService(),
        buildTaskTriggerClient(),
        buildValidateApiKeyUseCase(vi.fn().mockResolvedValue({ keyId: 'k1', userId: 'user-different', apiKey: 'hashed' })),
        buildFakeStrategy('github') as unknown as GithubScanTriggerStrategy,
        bitbucketStrategy as unknown as BitbucketScanTriggerStrategy
      )

      const result = await useCase.execute({ repositoryId: existingId, branch: 'main' })

      expect(result.repositoryIdWarning).toBeDefined()
    })

    it('never blocks or fails the trigger when the mismatch check itself errors (e.g. the service key does not validate)', async () => {
      const githubStrategy = buildFakeStrategy('github', { source: 'github', args: { github_repo_name: 'KaribuLab/titvo-rag-indexer' } })
      const runScan = vi.fn().mockResolvedValue({ message: 'Scan starting', scanId: 'scan-gh' })
      const useCase = new TriggerScanUseCase(
        buildRepoRepository([githubRepo]),
        buildConfigRepository(validConfig),
        buildAesService(),
        buildTaskTriggerClient(runScan),
        buildValidateApiKeyUseCase(vi.fn().mockRejectedValue(new Error('key not found'))),
        githubStrategy as unknown as GithubScanTriggerStrategy,
        buildFakeStrategy('bitbucket') as unknown as BitbucketScanTriggerStrategy
      )

      const result = await useCase.execute({ repositoryId: 'repo-1', branch: 'main' })

      expect(result.scanId).toBe('scan-gh')
      expect(result.repositoryIdWarning).toBeUndefined()
      expect(runScan).toHaveBeenCalled()
    })
  })
})
