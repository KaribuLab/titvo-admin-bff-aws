import { DynamoDBClient, DeleteItemCommand, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb'
import { Logger } from '@nestjs/common'
import { withRetry } from '@titvo/aws'
import { SessionEntity, SessionRepository, UserRole } from '@titvo/auth'

export interface SessionRepositoryOptions {
  tableName: string
  awsStage: string
  awsEndpoint: string
}

/**
 * Ported from titvo-auth-setup-aws's `DynamoSessionRepository` (Phase 1
 * batch 3) — same table shape, same field mapping. The BFF only needs
 * read + TTL-refresh access for the session guard (task 3.4); `create`
 * and `deleteById` are implemented for interface completeness (matches
 * titvo-auth's `SessionRepository` contract) but are unused until a
 * future batch adds a BFF-side logout endpoint.
 */
export class DynamoSessionRepository extends SessionRepository {
  private readonly logger = new Logger(DynamoSessionRepository.name)
  private readonly tableName: string
  private readonly dynamoDBClient: DynamoDBClient

  constructor (dynamoDBClient: DynamoDBClient, tableName: string) {
    super()
    this.dynamoDBClient = dynamoDBClient
    this.tableName = tableName
  }

  async create (session: SessionEntity): Promise<void> {
    await withRetry(async () => {
      return this.dynamoDBClient.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: {
            session_id: { S: session.sessionId },
            user_id: { S: session.userId },
            role: { S: session.role },
            ttl: { N: String(session.ttl) },
            created_at: { S: session.createdAt }
          }
        })
      )
    }, `create(${session.sessionId})`, { logger: this.logger })
  }

  async findById (sessionId: string): Promise<SessionEntity | null> {
    try {
      const result = await withRetry(async () => {
        return this.dynamoDBClient.send(
          new GetItemCommand({
            TableName: this.tableName,
            Key: {
              session_id: { S: sessionId }
            }
          })
        )
      }, `findById(${sessionId})`, { logger: this.logger })

      if (result.Item == null) {
        return null
      }

      const item = result.Item
      return {
        sessionId: item.session_id?.S ?? '',
        userId: item.user_id?.S ?? '',
        role: (item.role?.S ?? 'member') as UserRole,
        ttl: Number(item.ttl?.N ?? '0'),
        createdAt: item.created_at?.S ?? ''
      }
    } catch (error) {
      this.logger.warn(`[SessionRepository] Error finding by id: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return null
    }
  }

  async deleteById (sessionId: string): Promise<void> {
    await withRetry(async () => {
      return this.dynamoDBClient.send(
        new DeleteItemCommand({
          TableName: this.tableName,
          Key: {
            session_id: { S: sessionId }
          }
        })
      )
    }, `deleteById(${sessionId})`, { logger: this.logger })
  }

  async refreshTtl (sessionId: string, ttl: number): Promise<void> {
    await withRetry(async () => {
      return this.dynamoDBClient.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: {
            session_id: { S: sessionId }
          },
          UpdateExpression: 'SET #ttl = :ttl',
          ExpressionAttributeNames: {
            '#ttl': 'ttl'
          },
          ExpressionAttributeValues: {
            ':ttl': { N: String(ttl) }
          }
        })
      )
    }, `refreshTtl(${sessionId})`, { logger: this.logger })
  }
}

export function createSessionRepository (options: SessionRepositoryOptions): SessionRepository {
  const dynamoDBClient = options.awsStage === 'localstack'
    ? new DynamoDBClient({ endpoint: options.awsEndpoint })
    : new DynamoDBClient()

  return new DynamoSessionRepository(dynamoDBClient, options.tableName)
}
