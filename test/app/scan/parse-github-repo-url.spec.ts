import { describe, expect, it } from 'vitest'
import { parseGithubRepoUrl } from '@app/scan/parse-github-repo-url'
import { RepoUrlInvalidError } from '@app/scan/scan-trigger.error'

describe('parseGithubRepoUrl', () => {
  it('parses an https URL without .git', () => {
    expect(parseGithubRepoUrl('https://github.com/KaribuLab/titvo-rag-indexer')).toEqual({ owner: 'KaribuLab', repo: 'titvo-rag-indexer' })
  })

  it('parses an https URL with a .git suffix and trailing slash', () => {
    expect(parseGithubRepoUrl('https://github.com/KaribuLab/titvo-rag-indexer.git/')).toEqual({ owner: 'KaribuLab', repo: 'titvo-rag-indexer' })
  })

  it('parses an SSH URL', () => {
    expect(parseGithubRepoUrl('git@github.com:KaribuLab/titvo-rag-indexer.git')).toEqual({ owner: 'KaribuLab', repo: 'titvo-rag-indexer' })
  })

  it('throws RepoUrlInvalidError for a non-GitHub URL', () => {
    expect(() => parseGithubRepoUrl('https://bitbucket.org/KaribuLab/titvo-rag-indexer')).toThrow(RepoUrlInvalidError)
  })

  it('throws RepoUrlInvalidError for a malformed URL', () => {
    expect(() => parseGithubRepoUrl('not-a-url')).toThrow(RepoUrlInvalidError)
  })
})
