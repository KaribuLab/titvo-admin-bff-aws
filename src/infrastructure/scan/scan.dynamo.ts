import { AttributeValue, DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
import { convertToNative } from '@aws-sdk/util-dynamodb'
import { Logger } from '@nestjs/common'
import { withRetry } from '@titvo/aws'
import { ScanRepository } from '@core/scan/scan.repository'
import { ScanDetail, ScanSummary } from '@core/scan/scan.entity'
import { executionStatusFromResult } from '@core/scan/scan-outcome'

export interface ScanRepositoryOptions {
  taskTableName: string
  awsStage: string
  awsEndpoint: string
}

const REPOSITORY_ID_INDEX = 'repository_id_index'

/**
 * Error names DynamoDB raises while a just-created GSI is still
 * backfilling (design "Migration / rollout": DynamoDB permits only one
 * GSI creation at a time and the index is `CREATING` until backfill
 * completes). Treated as "index not ready yet" and degraded to an empty
 * result, never a 500.
 */
const GSI_NOT_READY_ERROR_NAMES = new Set(['ResourceNotFoundException', 'ValidationException'])

function isIndexNotReadyError (error: unknown): boolean {
  return error instanceof Error && GSI_NOT_READY_ERROR_NAMES.has(error.name)
}

/**
 * Reads `task` DIRECTLY (design D1 — never proxies through
 * titvo-task-status-aws) via the `repository_id_index` GSI (design D2)
 * for repo-scoped scan lists and the "last scan" embed, and a
 * base-table `GetItem` by `scan_id` for detail. `findById` does NOT
 * resolve/join `repository_id` against the `repository` table, so an
 * orphan `repository_id` on a scan never breaks scan detail.
 */
export class DynamoScanRepository extends ScanRepository {
  private readonly logger = new Logger(DynamoScanRepository.name)
  private readonly taskTableName: string
  private readonly dynamoDBClient: DynamoDBClient

  constructor (dynamoDBClient: DynamoDBClient, taskTableName: string) {
    super()
    this.dynamoDBClient = dynamoDBClient
    this.taskTableName = taskTableName
  }

  async findLatestByRepositoryId (repositoryId: string): Promise<ScanSummary | null> {
    const items = await this.queryByRepositoryId(repositoryId, 1)
    return items[0] ?? null
  }

  async findAllByRepositoryId (repositoryId: string): Promise<ScanSummary[]> {
    return await this.queryByRepositoryId(repositoryId)
  }

  async findById (scanId: string): Promise<ScanDetail | null> {
    const result = await withRetry(async () => {
      return await this.dynamoDBClient.send(
        new GetItemCommand({
          TableName: this.taskTableName,
          Key: { scan_id: { S: scanId } }
        })
      )
    }, `findById(${scanId})`, { logger: this.logger })

    if (result.Item == null) {
      return null
    }

    return mapItemToScanDetail(result.Item)
  }

  private async queryByRepositoryId (repositoryId: string, limit?: number): Promise<ScanSummary[]> {
    try {
      const result = await withRetry(async () => {
        return await this.dynamoDBClient.send(
          new QueryCommand({
            TableName: this.taskTableName,
            IndexName: REPOSITORY_ID_INDEX,
            KeyConditionExpression: 'repository_id = :repository_id',
            ExpressionAttributeValues: { ':repository_id': { S: repositoryId } },
            ScanIndexForward: false,
            ...(limit !== undefined ? { Limit: limit } : {})
          })
        )
      }, `queryByRepositoryId(${repositoryId})`, { logger: this.logger })

      return (result.Items ?? []).map(mapItemToScanSummary)
    } catch (error) {
      if (isIndexNotReadyError(error)) {
        this.logger.warn(`[ScanRepository] repository_id_index not ready yet (${error instanceof Error ? error.name : 'unknown'}) — degrading to empty scan list for repository ${repositoryId}`)
        return []
      }
      throw error
    }
  }
}

function toNative (attribute: AttributeValue | undefined): unknown {
  if (attribute == null) {
    return undefined
  }
  try {
    return convertToNative(attribute)
  } catch {
    return undefined
  }
}

function mapItemToScanSummary (item: Record<string, AttributeValue>): ScanSummary {
  return {
    scanId: item.scan_id?.S ?? '',
    repositoryId: item.repository_id?.S ?? '',
    status: item.status?.S ?? 'unknown',
    executionStatus: executionStatusFromResult(toNative(item.scan_result ?? item.result)),
    source: item.source?.S,
    branch: item.branch?.S,
    createdAt: item.created_at?.S,
    updatedAt: item.updated_at?.S,
    jobId: item.job_id?.S
  }
}

function mapItemToScanDetail (item: Record<string, AttributeValue>): ScanDetail {
  return {
    ...mapItemToScanSummary(item),
    args: toNative(item.args),
    // Attribute name unconfirmed like the `repository` table (design D2
    // rationale references "scan_result blobs"); accept either
    // `scan_result` or `result` defensively rather than assume one.
    result: toNative(item.scan_result ?? item.result)
  }
}

export function createScanRepository (options: ScanRepositoryOptions): ScanRepository {
  const dynamoDBClient = options.awsStage === 'localstack'
    ? new DynamoDBClient({ endpoint: options.awsEndpoint })
    : new DynamoDBClient()

  return new DynamoScanRepository(dynamoDBClient, options.taskTableName)
}
