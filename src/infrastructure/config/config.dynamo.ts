import { AttributeValue, DynamoDBClient, GetItemCommand, PutItemCommand, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb'
import { Logger } from '@nestjs/common'
import { withRetry } from '@titvo/aws'
import { ConfigRepository, ConfigUpdatePatch, NewConfigItem } from '@core/config/config.repository'
import { ConfigItem } from '@core/config/config.entity'
import { ConfigAlreadyExistsError } from '@app/config/config.error'

export interface ConfigRepositoryOptions {
  tableName: string
  awsStage: string
  awsEndpoint: string
}

/**
 * Reads/writes `tvo-security-scan-parameter-prod` — the SAME table the CLI
 * wizard (`titvo-installer`'s `secret`/`parameter` subcommands) already
 * writes, using its exact `parameter_id`/`value` item shape (design's
 * DynamoDB schema section). `is_secret`/`updated_at`/`updated_by` are
 * additive attributes this feature introduces; legacy CLI-written items
 * simply lack them (mapped as `isSecret: undefined`, resolved by
 * `resolveIsSecret` at the use-case layer — never here).
 */
export class DynamoConfigRepository extends ConfigRepository {
  private readonly logger = new Logger(DynamoConfigRepository.name)
  private readonly tableName: string
  private readonly dynamoDBClient: DynamoDBClient

  constructor (dynamoDBClient: DynamoDBClient, tableName: string) {
    super()
    this.dynamoDBClient = dynamoDBClient
    this.tableName = tableName
  }

  async findAll (): Promise<ConfigItem[]> {
    const result = await withRetry(async () => {
      return this.dynamoDBClient.send(new ScanCommand({ TableName: this.tableName }))
    }, 'findAll()', { logger: this.logger })

    return (result.Items ?? []).map(mapItemToConfigEntity)
  }

  async findById (parameterId: string): Promise<ConfigItem | null> {
    const result = await withRetry(async () => {
      return this.dynamoDBClient.send(
        new GetItemCommand({
          TableName: this.tableName,
          Key: { parameter_id: { S: parameterId } }
        })
      )
    }, `findById(${parameterId})`, { logger: this.logger })

    if (result.Item == null) {
      return null
    }

    return mapItemToConfigEntity(result.Item)
  }

  async putNew (item: NewConfigItem): Promise<void> {
    try {
      await withRetry(async () => {
        return this.dynamoDBClient.send(
          new PutItemCommand({
            TableName: this.tableName,
            Item: {
              parameter_id: { S: item.parameterId },
              value: { S: item.value },
              is_secret: { BOOL: item.isSecret },
              updated_at: { S: item.updatedAt },
              updated_by: { S: item.updatedBy }
            },
            ConditionExpression: 'attribute_not_exists(parameter_id)'
          })
        )
      }, `putNew(${item.parameterId})`, { logger: this.logger })
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new ConfigAlreadyExistsError(`Config entry '${item.parameterId}' already exists`)
      }
      throw error
    }
  }

  async update (parameterId: string, patch: ConfigUpdatePatch): Promise<void> {
    const setClauses = ['#is_secret = :is_secret', '#updated_at = :updated_at', '#updated_by = :updated_by']
    const names: Record<string, string> = { '#is_secret': 'is_secret', '#updated_at': 'updated_at', '#updated_by': 'updated_by' }
    const values: Record<string, AttributeValue> = {
      ':is_secret': { BOOL: patch.isSecret },
      ':updated_at': { S: patch.updatedAt },
      ':updated_by': { S: patch.updatedBy }
    }

    if (patch.value !== undefined) {
      setClauses.push('#value = :value')
      names['#value'] = 'value'
      values[':value'] = { S: patch.value }
    }

    await withRetry(async () => {
      return this.dynamoDBClient.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: { parameter_id: { S: parameterId } },
          UpdateExpression: `SET ${setClauses.join(', ')}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values
        })
      )
    }, `update(${parameterId})`, { logger: this.logger })
  }
}

function mapItemToConfigEntity (item: Record<string, { S?: string, BOOL?: boolean }>): ConfigItem {
  return {
    parameterId: item.parameter_id?.S ?? '',
    value: item.value?.S ?? '',
    isSecret: item.is_secret?.BOOL,
    updatedAt: item.updated_at?.S,
    updatedBy: item.updated_by?.S
  }
}

export function createConfigRepository (options: ConfigRepositoryOptions): ConfigRepository {
  const dynamoDBClient = options.awsStage === 'localstack'
    ? new DynamoDBClient({ endpoint: options.awsEndpoint })
    : new DynamoDBClient()

  return new DynamoConfigRepository(dynamoDBClient, options.tableName)
}
