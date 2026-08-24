import { RepoUrlInvalidError } from './scan-trigger.error'

/**
 * Parses `https://bitbucket.org/workspace/repo(.git)` or
 * `git@bitbucket.org:workspace/repo(.git)` into `{workspace, repoSlug}`.
 * Mirrors the tolerant last-two-path-segments parsing already proven in
 * titvo-git-commit-files-aws's live `BitbucketClientService.initFromRepoUrl`
 * (`respositories-handler/bitbucket/bitbucket-client.service.ts`), plus one
 * extra guard requiring `bitbucket.org` in the URL so a repo mis-tagged
 * with `provider: 'bitbucket'` but a non-Bitbucket URL fails loudly instead
 * of silently parsing garbage.
 */
export function parseBitbucketRepoUrl (url: string): { workspace: string, repoSlug: string } {
  const cleaned = url.trim().replace(/^git\+/, '').replace(/\/+$/, '').replace(/\.git$/, '')

  if (!cleaned.includes('bitbucket.org')) {
    throw new RepoUrlInvalidError(`Unsupported or unrecognized Bitbucket repository URL: ${url}`)
  }

  const parts = cleaned.split(/[/:]/).filter(part => part.length > 0)
  if (parts.length < 2) {
    throw new RepoUrlInvalidError(`Unsupported or unrecognized Bitbucket repository URL: ${url}`)
  }

  const repoSlug = parts[parts.length - 1]
  const workspace = parts[parts.length - 2]
  return { workspace, repoSlug }
}
