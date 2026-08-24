import { describe, expect, it } from 'vitest'
import { parseBitbucketRepoUrl } from '@app/scan/parse-bitbucket-repo-url'
import { RepoUrlInvalidError } from '@app/scan/scan-trigger.error'

describe('parseBitbucketRepoUrl', () => {
  it('parses an https URL without .git', () => {
    expect(parseBitbucketRepoUrl('https://bitbucket.org/karibu/titvo-legacy')).toEqual({ workspace: 'karibu', repoSlug: 'titvo-legacy' })
  })

  it('parses an https URL with a .git suffix and trailing slash', () => {
    expect(parseBitbucketRepoUrl('https://bitbucket.org/karibu/titvo-legacy.git/')).toEqual({ workspace: 'karibu', repoSlug: 'titvo-legacy' })
  })

  it('parses an SSH URL', () => {
    expect(parseBitbucketRepoUrl('git@bitbucket.org:karibu/titvo-legacy.git')).toEqual({ workspace: 'karibu', repoSlug: 'titvo-legacy' })
  })

  it('throws RepoUrlInvalidError for a non-Bitbucket URL', () => {
    expect(() => parseBitbucketRepoUrl('https://github.com/karibu/titvo-legacy')).toThrow(RepoUrlInvalidError)
  })

  it('throws RepoUrlInvalidError for a malformed URL', () => {
    expect(() => parseBitbucketRepoUrl('not-a-url')).toThrow(RepoUrlInvalidError)
  })
})
