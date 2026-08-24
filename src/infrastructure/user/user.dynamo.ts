import { AttributeValue, DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb'
import { Logger } from '@nestjs/common'
import { withRetry } from '@titvo/aws'
import { UserEntity, UserRepository, UserRole, UserStatus } from '@titvo/auth'
import { UserNotFoundError } from '@app/user/user.error'

export interface UserRepositoryOptions {
  tableName: string
  awsStage: string
  awsEndpoint: string
}

/**
 * Ported from titvo-auth-setup-aws's `DynamoUserRepository` (Phase 1
 * batch 3) — reads the exact item shape titvo-installer's `seed-admin`
 * writes (`user_id`, `email`, `password_hash`, `role`, `created_at`,
 * `updated_at`). Only `findById` is exercised by the session guard;
 * `findByEmail` exists for interface completeness (used by a future
 * BFF-side login endpoint, out of scope this batch).
 */
export class DynamoUserRepository extends UserRepository {
  private readonly logger = new Logger(DynamoUserRepository.name)
  private readonly tableName: string
  private readonly dynamoDBClient: DynamoDBClient

  constructor (dynamoDBClient: DynamoDBClient, tableName: string) {
    super()
    this.dynamoDBClient = dynamoDBClient
    this.tableName = tableName
  }

  async findByEmail (email: string): Promise<UserEntity | null> {
    try {
      const result = await withRetry(async () => {
        return this.dynamoDBClient.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: 'EmailIndex',
            KeyConditionExpression: 'email = :email',
            ExpressionAttributeValues: {
              ':email': { S: email }
            }
          })
        )
      }, `findByEmail(${email})`, { logger: this.logger })

      if ((result.Items == null) || result.Items.length === 0) {
        return null
      }

      return mapItemToUserEntity(result.Items[0])
    } catch (error) {
      this.logger.warn(`[UserRepository] Error finding by email: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return null
    }
  }

  async findById (userId: string): Promise<UserEntity | null> {
    try {
      const result = await withRetry(async () => {
        return this.dynamoDBClient.send(
          new GetItemCommand({
            TableName: this.tableName,
            Key: {
              user_id: { S: userId }
            }
          })
        )
      }, `findById(${userId})`, { logger: this.logger })

      if (result.Item == null) {
        return null
      }

      return mapItemToUserEntity(result.Item)
    } catch (error) {
      this.logger.warn(`[UserRepository] Error finding by id: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return null
    }
  }

  /**
   * Lists every user (design D6: plain `Scan`, no dedicated role/status
   * GSI — single internal team). Backs both the admin console's user list
   * and the last-admin invariant guard (`@titvo/auth`'s
   * `countActiveAdmins`/`wouldViolateLastAdminInvariant`), which operate
   * on this exact snapshot shape.
   */
  async findAll (): Promise<UserEntity[]> {
    const result = await withRetry(async () => {
      return this.dynamoDBClient.send(new ScanCommand({ TableName: this.tableName }))
    }, 'findAll()', { logger: this.logger })

    return (result.Items ?? []).map(mapItemToUserEntity)
  }

  /**
   * Persists a new user. `ConditionExpression: attribute_not_exists`
   * guards against overwriting an existing `user_id` (design "IAM
   * deltas"/file-changes note) — the email-uniqueness check itself is a
   * separate, accepted non-atomic `findByEmail` race at the use-case
   * layer (`CreateUserUseCase`), same category as the last-admin race.
   */
  async create (entity: UserEntity): Promise<UserEntity> {
    const item: Record<string, AttributeValue> = {
      user_id: { S: entity.userId },
      email: { S: entity.email },
      password_hash: { S: entity.passwordHash },
      role: { S: entity.role },
      created_at: { S: entity.createdAt },
      updated_at: { S: entity.updatedAt }
    }
    if (entity.status !== undefined) item.status = { S: entity.status }

    await withRetry(async () => {
      return this.dynamoDBClient.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(#user_id)',
          ExpressionAttributeNames: { '#user_id': 'user_id' }
        })
      )
    }, `create(${entity.userId})`, { logger: this.logger })

    return entity
  }

  /**
   * Applies a partial role/status patch. `ConditionExpression:
   * attribute_exists(#user_id)` prevents DynamoDB's default
   * UpdateItem-creates-a-phantom-item behavior for an unknown `userId`
   * (same pitfall/fix as `DynamoApiKeyRepository.revoke`, Work Unit 5),
   * translated to `UserNotFoundError`.
   */
  async update (userId: string, patch: Partial<Pick<UserEntity, 'role' | 'status'>>): Promise<UserEntity> {
    const setClauses: string[] = ['#updated_at = :updated_at']
    const names: Record<string, string> = { '#user_id': 'user_id', '#updated_at': 'updated_at' }
    const values: Record<string, AttributeValue> = { ':updated_at': { S: new Date().toISOString() } }

    if (patch.role !== undefined) {
      setClauses.push('#role = :role')
      names['#role'] = 'role'
      values[':role'] = { S: patch.role }
    }
    if (patch.status !== undefined) {
      setClauses.push('#status = :status')
      names['#status'] = 'status'
      values[':status'] = { S: patch.status }
    }

    try {
      const result = await withRetry(async () => {
        return this.dynamoDBClient.send(
          new UpdateItemCommand({
            TableName: this.tableName,
            Key: { user_id: { S: userId } },
            UpdateExpression: `SET ${setClauses.join(', ')}`,
            ConditionExpression: 'attribute_exists(#user_id)',
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            ReturnValues: 'ALL_NEW'
          })
        )
      }, `update(${userId})`, { logger: this.logger })

      return mapItemToUserEntity(result.Attributes ?? {})
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new UserNotFoundError(`User '${userId}' does not exist`)
      }
      throw error
    }
  }
}

function mapItemToUserEntity (item: Record<string, { S?: string }>): UserEntity {
  return {
    userId: item.user_id?.S ?? '',
    email: item.email?.S ?? '',
    passwordHash: item.password_hash?.S ?? '',
    role: (item.role?.S ?? 'member') as UserRole,
    status: item.status?.S as UserStatus | undefined,
    createdAt: item.created_at?.S ?? '',
    updatedAt: item.updated_at?.S ?? ''
  }
}

export function createUserRepository (options: UserRepositoryOptions): UserRepository {
  const dynamoDBClient = options.awsStage === 'localstack'
    ? new DynamoDBClient({ endpoint: options.awsEndpoint })
    : new DynamoDBClient()

  return new DynamoUserRepository(dynamoDBClient, options.tableName)
}
