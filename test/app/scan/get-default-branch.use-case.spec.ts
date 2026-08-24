import { describe, expect, it, vi } from 'vitest'
import { AesService } from '@titvo/shared'
import { RepoRepository } from '@core/repo/repo.repository'
import { RepoItem } from '@core/repo/repo.entity'
import { ConfigRepository } from '@core/config/config.repository'
import { ConfigItem } from '@core/config/config.entity'
import { GithubApiClient } from '@core/scan/github-api.client'
import { BitbucketApiClient } from '@core/scan/bitbucket-api.client'
import { GetDefaultBranchUseCase } from '@app/scan/get-default-branch.use-case'
import { RepoNotFoundError, RepoUrlInvalidError, UnsupportedProviderError, ConfigMissingError } from '@app/scan/scan-trigger.error'

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

function buildGithubApiClient (fetchDefaultBranch: (url: string, token: string) => Promise<string> = vi.fn().mockResolvedValue('main')): GithubApiClient {
  return { resolveBranchSha: vi.fn(), fetchDefaultBranch } as unknown as GithubApiClient
}

function buildBitbucketApiClient (fetchDefaultBranch: (workspace: string, repoSlug: string, token: string) => Promise<string> = vi.fn().mockResolvedValue('master')): BitbucketApiClient {
  return { resolveBranchCommit: vi.fn(), fetchProjectKey: vi.fn(), fetchDefaultBranch } as unknown as BitbucketApiClient
}

const githubRepo: RepoItem = { repositoryId: 'repo-1', url: 'https://github.com/KaribuLab/titvo-rag-indexer', provider: 'github' }
const bitbucketRepo: RepoItem = { repositoryId: 'repo-2', url: 'https://bitbucket.org/karibu/titvo-legacy', provider: 'bitbucket' }

describe('GetDefaultBranchUseCase', () => {
  it('throws RepoNotFoundError when the repo does not exist', async () => {
    const useCase = new GetDefaultBranchUseCase(buildRepoRepository([]), buildConfigRepository({}), buildAesService(), buildGithubApiClient(), buildBitbucketApiClient())

    await expect(useCase.execute('missing')).rejects.toThrow(RepoNotFoundError)
  })

  it('throws RepoUrlInvalidError when the repo has no url on record', async () => {
    const useCase = new GetDefaultBranchUseCase(
      buildRepoRepository([{ repositoryId: 'repo-1', provider: 'github' }]),
      buildConfigRepository({}),
      buildAesService(),
      buildGithubApiClient(),
      buildBitbucketApiClient()
    )

    await expect(useCase.execute('repo-1')).rejects.toThrow(RepoUrlInvalidError)
  })

  it('throws UnsupportedProviderError for a provider with no matching branch-lookup path', async () => {
    const useCase = new GetDefaultBranchUseCase(
      buildRepoRepository([{ repositoryId: 'repo-3', url: 'https://gitlab.com/a/b', provider: 'gitlab' }]),
      buildConfigRepository({}),
      buildAesService(),
      buildGithubApiClient(),
      buildBitbucketApiClient()
    )

    await expect(useCase.execute('repo-3')).rejects.toThrow(UnsupportedProviderError)
  })

  it('fetches the default branch for a github repo using github_access_token', async () => {
    const fetchDefaultBranch = vi.fn().mockResolvedValue('develop')
    const useCase = new GetDefaultBranchUseCase(
      buildRepoRepository([githubRepo]),
      buildConfigRepository({ github_access_token: { parameterId: 'github_access_token', value: 'ciphertext', isSecret: true } }),
      buildAesService(),
      buildGithubApiClient(fetchDefaultBranch),
      buildBitbucketApiClient()
    )

    const result = await useCase.execute('repo-1')

    expect(result).toEqual({ branch: 'develop' })
    expect(fetchDefaultBranch).toHaveBeenCalledWith('https://github.com/KaribuLab/titvo-rag-indexer', 'plain:ciphertext')
  })

  it('throws ConfigMissingError naming github_access_token when it is not set', async () => {
    const useCase = new GetDefaultBranchUseCase(
      buildRepoRepository([githubRepo]),
      buildConfigRepository({}),
      buildAesService(),
      buildGithubApiClient(),
      buildBitbucketApiClient()
    )

    const error = await useCase.execute('repo-1').catch(e => e)
    expect(error).toBeInstanceOf(ConfigMissingError)
    expect((error as ConfigMissingError).parameterId).toBe('github_access_token')
  })

  it('fetches the default branch for a bitbucket repo using bitbucket_api_token', async () => {
    const fetchDefaultBranch = vi.fn().mockResolvedValue('master')
    const useCase = new GetDefaultBranchUseCase(
      buildRepoRepository([bitbucketRepo]),
      buildConfigRepository({ bitbucket_api_token: { parameterId: 'bitbucket_api_token', value: 'ciphertext', isSecret: true } }),
      buildAesService(),
      buildGithubApiClient(),
      buildBitbucketApiClient(fetchDefaultBranch)
    )

    const result = await useCase.execute('repo-2')

    expect(result).toEqual({ branch: 'master' })
    expect(fetchDefaultBranch).toHaveBeenCalledWith('karibu', 'titvo-legacy', 'plain:ciphertext')
  })

  it('throws ConfigMissingError naming bitbucket_api_token when it is not set', async () => {
    const useCase = new GetDefaultBranchUseCase(
      buildRepoRepository([bitbucketRepo]),
      buildConfigRepository({}),
      buildAesService(),
      buildGithubApiClient(),
      buildBitbucketApiClient()
    )

    const error = await useCase.execute('repo-2').catch(e => e)
    expect(error).toBeInstanceOf(ConfigMissingError)
    expect((error as ConfigMissingError).parameterId).toBe('bitbucket_api_token')
  })

  it('propagates a lookup failure from the provider API client', async () => {
    const useCase = new GetDefaultBranchUseCase(
      buildRepoRepository([githubRepo]),
      buildConfigRepository({ github_access_token: { parameterId: 'github_access_token', value: 'ciphertext', isSecret: true } }),
      buildAesService(),
      buildGithubApiClient(vi.fn().mockRejectedValue(new Error('repo not found'))),
      buildBitbucketApiClient()
    )

    await expect(useCase.execute('repo-1')).rejects.toThrow('repo not found')
  })
})
