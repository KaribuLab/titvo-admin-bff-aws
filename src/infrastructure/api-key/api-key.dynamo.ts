import { AttributeValue, DynamoDBClient, PutItemCommand, QueryCommand, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb'
import { Logger } from '@nestjs/common'
import { withRetry } from '@titvo/aws'
import { ApiKeyEntity, ApiKeyNotFoundError, ApiKeyRepository } from '@titvo/auth'

export interface ApiKeyRepositoryOptions {
  tableName: string
  awsStage: string
  awsEndpoint: string
}

/**
 * Reads/writes `apikey` using titvo-task-trigger-aws's existing
 * `DynamoApiKeyRepository` attribute names (`key_id`, `user_id`,
 * `api_key` — the hash, despite the name) PLUS the new WU2 attributes
 * this unit is the first to actually write (`label`, `status`,
 * `created_at`, `created_by`, `revoked_at`, `last_used_at`). `findAll`
 * uses a plain `Scan` (design D3-style: single internal team, small
 * table, no new GSI needed for listing). `findByUserId`/`findByApiKey`
 * mirror the existing production repository's Query/localstack-Scan
 * shape for interface completeness — this BFF's own use-cases never
 * call them, only `findAll`/`create`/`revoke`/`activate` back the
 * console endpoints.
 */
export class DynamoApiKeyRepository extends ApiKeyRepository {
  private readonly logger = new Logger(DynamoApiKeyRepository.name)
  private readonly tableName: string
  private readonly dynamoDBClient: DynamoDBClient
  private readonly awsStage: string

  constructor (dynamoDBClient: DynamoDBClient, tableName: string, awsStage: string) {
    super()
    this.dynamoDBClient = dynamoDBClient
    this.tableName = tableName
    this.awsStage = awsStage
  }

  async findByUserId (userId: string): Promise<ApiKeyEntity | null> {
    try {
      const result = this.awsStage === 'localstack'
        ? await withRetry(async () => {
          return this.dynamoDBClient.send(
            new ScanCommand({
              TableName: this.tableName,
              FilterExpression: 'user_id = :userId',
              ExpressionAttributeValues: { ':userId': { S: userId } }
            })
          )
        }, `findByUserId(${userId})`, { logger: this.logger })
        : await withRetry(async () => {
          return this.dynamoDBClient.send(
            new QueryCommand({
              TableName: this.tableName,
              IndexName: 'user_id_gsi',
              KeyConditionExpression: 'user_id = :userId',
              ExpressionAttributeValues: { ':userId': { S: userId } }
            })
          )
        }, `findByUserId(${userId})`, { logger: this.logger })

      if ((result.Items == null) || result.Items.length === 0) {
        return null
      }

      return mapItemToApiKeyEntity(result.Items[0])
    } catch (error) {
      this.logger.warn(`[ApiKeyRepository] Error finding by userId: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return null
    }
  }

  async findByApiKey (apiKey: string): Promise<ApiKeyEntity | null> {
    try {
      const result = this.awsStage === 'localstack'
        ? await withRetry(async () => {
          return this.dynamoDBClient.send(
            new ScanCommand({
              TableName: this.tableName,
              FilterExpression: 'api_key = :apiKey',
              ExpressionAttributeValues: { ':apiKey': { S: apiKey } }
            })
          )
        }, `findByApiKey(${apiKey})`, { logger: this.logger })
        : await withRetry(async () => {
          return this.dynamoDBClient.send(
            new QueryCommand({
              TableName: this.tableName,
              IndexName: 'api_key_gsi',
              KeyConditionExpression: 'api_key = :apiKey',
              ExpressionAttributeValues: { ':apiKey': { S: apiKey } }
            })
          )
        }, `findByApiKey(${apiKey})`, { logger: this.logger })

      if ((result.Items == null) || result.Items.length === 0) {
        return null
      }

      return mapItemToApiKeyEntity(result.Items[0])
    } catch (error) {
      this.logger.warn(`[ApiKeyRepository] Error finding by apiKey: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return null
    }
  }

  async findAll (): Promise<ApiKeyEntity[]> {
    const result = await withRetry(async () => {
      return this.dynamoDBClient.send(new ScanCommand({ TableName: this.tableName }))
    }, 'findAll()', { logger: this.logger })

    return (result.Items ?? []).map(mapItemToApiKeyEntity)
  }

  async create (entity: ApiKeyEntity): Promise<ApiKeyEntity> {
    const item: Record<string, AttributeValue> = {
      key_id: { S: entity.keyId },
      user_id: { S: entity.userId },
      api_key: { S: entity.apiKey }
    }
    if (entity.label !== undefined) item.label = { S: entity.label }
    if (entity.status !== undefined) item.status = { S: entity.status }
    if (entity.createdAt !== undefined) item.created_at = { S: entity.createdAt }
    if (entity.createdBy !== undefined) item.created_by = { S: entity.createdBy }

    await withRetry(async () => {
      return this.dynamoDBClient.send(new PutItemCommand({ TableName: this.tableName, Item: item }))
    }, `create(${entity.keyId})`, { logger: this.logger })

    return entity
  }

  async revoke (keyId: string): Promise<ApiKeyEntity> {
    try {
      const result = await withRetry(async () => {
        return this.dynamoDBClient.send(
          new UpdateItemCommand({
            TableName: this.tableName,
            Key: { key_id: { S: keyId } },
            UpdateExpression: 'SET #status = :status, #revoked_at = :revoked_at',
            ConditionExpression: 'attribute_exists(#key_id)',
            ExpressionAttributeNames: { '#key_id': 'key_id', '#status': 'status', '#revoked_at': 'revoked_at' },
            ExpressionAttributeValues: { ':status': { S: 'revoked' }, ':revoked_at': { S: new Date().toISOString() } },
            ReturnValues: 'ALL_NEW'
          })
        )
      }, `revoke(${keyId})`, { logger: this.logger })

      return mapItemToApiKeyEntity(result.Attributes ?? {})
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new ApiKeyNotFoundError(`API key '${keyId}' does not exist`)
      }
      throw error
    }
  }

  async activate (keyId: string): Promise<void> {
    await withRetry(async () => {
      return this.dynamoDBClient.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: { key_id: { S: keyId } },
          UpdateExpression: 'SET #status = :status REMOVE #revoked_at',
          ExpressionAttributeNames: { '#status': 'status', '#revoked_at': 'revoked_at' },
          ExpressionAttributeValues: { ':status': { S: 'active' } }
        })
      )
    }, `activate(${keyId})`, { logger: this.logger })
  }
}

function mapItemToApiKeyEntity (item: Record<string, AttributeValue>): ApiKeyEntity {
  return {
    keyId: item.key_id?.S ?? '',
    userId: item.user_id?.S ?? '',
    apiKey: item.api_key?.S ?? '',
    label: item.label?.S,
    status: item.status?.S as ApiKeyEntity['status'],
    createdAt: item.created_at?.S,
    createdBy: item.created_by?.S,
    revokedAt: item.revoked_at?.S,
    lastUsedAt: item.last_used_at?.S
  }
}

export function createApiKeyRepository (options: ApiKeyRepositoryOptions): ApiKeyRepository {
  const dynamoDBClient = options.awsStage === 'localstack'
    ? new DynamoDBClient({ endpoint: options.awsEndpoint })
    : new DynamoDBClient()

  return new DynamoApiKeyRepository(dynamoDBClient, options.tableName, options.awsStage)
}
