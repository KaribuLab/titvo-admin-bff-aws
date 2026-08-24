import { RepoItem } from './repo.entity'

export abstract class RepoRepository {
  abstract findAll (): Promise<RepoItem[]>
}
