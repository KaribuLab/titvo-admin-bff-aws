import { createHash } from 'crypto'
import { describe, expect, it } from 'vitest'
import { computeExpectedRepositoryId, deriveRepositorySlug } from '@app/scan/compute-expected-repository-id'

describe('computeExpectedRepositoryId', () => {
  it('matches titvo-task-trigger-aws\'s own formula: `${userId}:${md5(slug)}`', () => {
    const expectedHash = createHash('md5').update('KaribuLab/titvo-rag-indexer').digest('hex')

    expect(computeExpectedRepositoryId('user-123', 'KaribuLab/titvo-rag-indexer')).toBe(`user-123:${expectedHash}`)
  })

  it('produces different ids for different owner userIds, same slug', () => {
    const a = computeExpectedRepositoryId('user-a', 'org/repo')
    const b = computeExpectedRepositoryId('user-b', 'org/repo')

    expect(a).not.toBe(b)
  })

  it('produces different ids for different slugs, same owner', () => {
    const a = computeExpectedRepositoryId('user-a', 'org/repo-one')
    const b = computeExpectedRepositoryId('user-a', 'org/repo-two')

    expect(a).not.toBe(b)
  })
})

describe('deriveRepositorySlug', () => {
  it('returns github_repo_name as-is for source "github"', () => {
    expect(deriveRepositorySlug('github', { github_repo_name: 'KaribuLab/titvo-rag-indexer' })).toBe('KaribuLab/titvo-rag-indexer')
  })

  it('returns undefined for github when github_repo_name is missing', () => {
    expect(deriveRepositorySlug('github', {})).toBeUndefined()
  })

  it('joins workspace/repo_slug for source "bitbucket"', () => {
    expect(deriveRepositorySlug('bitbucket', { bitbucket_workspace: 'karibu', bitbucket_repo_slug: 'titvo-legacy' })).toBe('karibu/titvo-legacy')
  })

  it('returns undefined for bitbucket when either field is missing', () => {
    expect(deriveRepositorySlug('bitbucket', { bitbucket_workspace: 'karibu' })).toBeUndefined()
    expect(deriveRepositorySlug('bitbucket', { bitbucket_repo_slug: 'titvo-legacy' })).toBeUndefined()
  })

  it('returns undefined for an unrecognized source', () => {
    expect(deriveRepositorySlug('gitlab', { some_field: 'x' })).toBeUndefined()
  })
})
