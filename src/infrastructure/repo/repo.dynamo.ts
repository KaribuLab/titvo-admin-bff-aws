import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb'
import { Logger } from '@nestjs/common'
import { withRetry } from '@titvo/aws'
import { RepoRepository } from '@core/repo/repo.repository'
import { RepoItem } from '@core/repo/repo.entity'

export interface RepoRepositoryOptions {
  tableName: string
  awsStage: string
  awsEndpoint: string
}

/**
 * Reads `repository` with a plain `Scan` — mirrors
 * `DynamoConfigRepository.findAll()` (design D3: single internal team,
 * no multi-tenancy, table stays small and unfiltered; no new GSI). The
 * item shape is NOT verifiable from this checkout (design risk
 * resolution #3, obs #884 item 3) — `mapItemToRepoEntity` is
 * deliberately tolerant: only `repository_id` (the hash key) is
 * trusted, every other field degrades to `undefined` instead of
 * throwing on a missing or differently-typed attribute.
 */
export class DynamoRepoRepository extends RepoRepository {
  private readonly logger = new Logger(DynamoRepoRepository.name)
  private readonly tableName: string
  private readonly dynamoDBClient: DynamoDBClient

  constructor (dynamoDBClient: DynamoDBClient, tableName: string) {
    super()
    this.dynamoDBClient = dynamoDBClient
    this.tableName = tableName
  }

  async findAll (): Promise<RepoItem[]> {
    const result = await withRetry(async () => {
      return this.dynamoDBClient.send(new ScanCommand({ TableName: this.tableName }))
    }, 'findAll()', { logger: this.logger })

    return (result.Items ?? []).map(mapItemToRepoEntity)
  }
}

function mapItemToRepoEntity (item: Record<string, { S?: string }>): RepoItem {
  return {
    repositoryId: item.repository_id?.S ?? '',
    userId: item.user_id?.S,
    name: item.name?.S,
    url: item.url?.S,
    provider: item.provider?.S,
    createdAt: item.created_at?.S
  }
}

export function createRepoRepository (options: RepoRepositoryOptions): RepoRepository {
  const dynamoDBClient = options.awsStage === 'localstack'
    ? new DynamoDBClient({ endpoint: options.awsEndpoint })
    : new DynamoDBClient()

  return new DynamoRepoRepository(dynamoDBClient, options.tableName)
}
