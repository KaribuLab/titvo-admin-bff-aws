import { describe, expect, it, vi } from 'vitest'
import { AesService } from '@titvo/shared'
import { RepoItem } from '@core/repo/repo.entity'
import { ConfigRepository } from '@core/config/config.repository'
import { ConfigItem } from '@core/config/config.entity'
import { GithubApiClient } from '@core/scan/github-api.client'
import { GithubScanTriggerStrategy } from '@app/scan/github-scan-trigger.strategy'
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

function buildGithubApiClient (resolveBranchSha: (url: string, token: string, branch: string) => Promise<string> = vi.fn().mockResolvedValue('a'.repeat(40))): GithubApiClient {
  return { resolveBranchSha } as unknown as GithubApiClient
}

const githubRepo: RepoItem = { repositoryId: 'repo-1', name: 'titvo-rag-indexer', url: 'https://github.com/KaribuLab/titvo-rag-indexer', provider: 'github' }

const validConfig: Record<string, ConfigItem | null> = {
  github_access_token: { parameterId: 'github_access_token', value: 'ciphertext-token', isSecret: true },
  default_github_assignee: { parameterId: 'default_github_assignee', value: 'octocat', isSecret: false }
}

describe('GithubScanTriggerStrategy', () => {
  it('supports only the github provider', () => {
    const strategy = new GithubScanTriggerStrategy(buildConfigRepository(validConfig), buildAesService(), buildGithubApiClient())
    expect(strategy.supports('github')).toBe(true)
    expect(strategy.supports('bitbucket')).toBe(false)
    expect(strategy.supports(undefined)).toBe(false)
  })

  it('throws RepoUrlInvalidError when the repo has no url on record', async () => {
    const strategy = new GithubScanTriggerStrategy(buildConfigRepository(validConfig), buildAesService(), buildGithubApiClient())

    await expect(strategy.buildRunScanPayload({ repositoryId: 'repo-1', provider: 'github' }, 'main')).rejects.toThrow(RepoUrlInvalidError)
  })

  it('throws ConfigMissingError naming github_access_token when it is not set', async () => {
    const strategy = new GithubScanTriggerStrategy(buildConfigRepository({ ...validConfig, github_access_token: null }), buildAesService(), buildGithubApiClient())

    const error = await strategy.buildRunScanPayload(githubRepo, 'main').catch(e => e)
    expect(error).toBeInstanceOf(ConfigMissingError)
    expect((error as ConfigMissingError).parameterId).toBe('github_access_token')
  })

  it('throws ConfigMissingError naming default_github_assignee when it is not set', async () => {
    const strategy = new GithubScanTriggerStrategy(buildConfigRepository({ ...validConfig, default_github_assignee: null }), buildAesService(), buildGithubApiClient())

    const error = await strategy.buildRunScanPayload(githubRepo, 'main').catch(e => e)
    expect(error).toBeInstanceOf(ConfigMissingError)
    expect((error as ConfigMissingError).parameterId).toBe('default_github_assignee')
  })

  it('decrypts the secret token, passes the plain assignee through as-is, and builds the exact source:"github" payload', async () => {
    const decrypt = vi.fn(async (value: string) => value.replace('ciphertext-', 'plain-'))
    const resolveBranchSha = vi.fn().mockResolvedValue('b'.repeat(40))
    const strategy = new GithubScanTriggerStrategy(buildConfigRepository(validConfig), buildAesService(decrypt), buildGithubApiClient(resolveBranchSha))

    const payload = await strategy.buildRunScanPayload(githubRepo, 'develop')

    expect(resolveBranchSha).toHaveBeenCalledWith('https://github.com/KaribuLab/titvo-rag-indexer', 'plain-token', 'develop')
    expect(payload).toEqual({
      source: 'github',
      args: {
        repository_url: 'https://github.com/KaribuLab/titvo-rag-indexer',
        github_token: 'plain-token',
        github_repo_name: 'KaribuLab/titvo-rag-indexer',
        github_commit_sha: 'b'.repeat(40),
        github_assignee: 'octocat',
        github_branch: 'develop'
      }
    })
  })

  it('propagates a branch-resolution failure from the GitHub API client', async () => {
    const strategy = new GithubScanTriggerStrategy(buildConfigRepository(validConfig), buildAesService(), buildGithubApiClient(vi.fn().mockRejectedValue(new Error('branch not found'))))

    await expect(strategy.buildRunScanPayload(githubRepo, 'no-such-branch')).rejects.toThrow('branch not found')
  })
})
