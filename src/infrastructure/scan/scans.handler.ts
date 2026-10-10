import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { ValidatedSession } from '@titvo/auth'
import { ListScansForRepoUseCase } from '@app/scan/list-scans-for-repo.use-case'
import { GetScanUseCase } from '@app/scan/get-scan.use-case'
import { TriggerScanUseCase } from '@app/scan/trigger-scan.use-case'
import { GetDefaultBranchUseCase } from '@app/scan/get-default-branch.use-case'
import { ScanDetail, ScanSummary } from '@core/scan/scan.entity'
import {
  RepoNotFoundError,
  UnsupportedProviderError,
  RepoUrlInvalidError,
  ConfigMissingError,
  BranchResolutionError,
  UpstreamScanTriggerError
} from '@app/scan/scan-trigger.error'
import { jsonResponse } from '../../utils/http-responses'

interface TriggerScanRequestBody {
  branch?: string
  scan_mode?: string
}

const VALID_SCAN_MODES = new Set(['commit', 'full'])

function toSummaryWireShape (item: ScanSummary): Record<string, unknown> {
  return {
    scan_id: item.scanId,
    status: item.status,
    execution_status: item.executionStatus,
    source: item.source,
    branch: item.branch,
    created_at: item.createdAt,
    updated_at: item.updatedAt
  }
}

function toDetailWireShape (item: ScanDetail): Record<string, unknown> {
  return {
    scan_id: item.scanId,
    repository_id: item.repositoryId,
    status: item.status,
    execution_status: item.executionStatus,
    source: item.source,
    branch: item.branch,
    args: item.args,
    result: item.result,
    created_at: item.createdAt,
    updated_at: item.updatedAt
  }
}

/**
 * `GET /api/admin/repos/:id/scans` — session-guarded, no role check
 * (read-accessible to `member` and `admin` alike), newest first. An
 * unknown or orphan `:id` renders `{items:[]}`, never an error.
 */
export async function handleListScansForRepo (listScansForRepoUseCase: ListScansForRepoUseCase, repositoryId: string): Promise<APIGatewayProxyStructuredResultV2> {
  const items = await listScansForRepoUseCase.execute(repositoryId)
  return jsonResponse(200, { items: items.map(toSummaryWireShape) })
}

/** `GET /api/admin/scans/:id` — session-guarded, no role check; `404 not_found` when the scan does not exist. */
export async function handleGetScan (getScanUseCase: GetScanUseCase, scanId: string): Promise<APIGatewayProxyStructuredResultV2> {
  const item = await getScanUseCase.execute(scanId)
  if (item === null) {
    return jsonResponse(404, { error: 'not_found' })
  }
  return jsonResponse(200, toDetailWireShape(item))
}

/**
 * `POST /api/admin/repos/:id/trigger-scan` — writes require `role ===
 * 'admin'` (same admin-only gate as config/api-key/user writes). Reuses
 * the SAME production `/run-scan` endpoint on titvo-task-trigger-aws that
 * GitHub Actions/Bitbucket Pipelines already call. Every failure mode maps
 * to a clean 4xx/5xx with a readable `message` — never a raw upstream body
 * or a bare 500 (decision #4: a missing config secret must fail with an
 * actionable error, not a cryptic one).
 */
export async function handleTriggerScan (
  triggerScanUseCase: TriggerScanUseCase,
  event: APIGatewayProxyEventV2,
  repositoryId: string,
  session: ValidatedSession
): Promise<APIGatewayProxyStructuredResultV2> {
  if (session.role !== 'admin') {
    return jsonResponse(403, { error: 'forbidden' })
  }

  const body = JSON.parse(event.body ?? '{}') as TriggerScanRequestBody
  if (body.branch === undefined || body.branch.trim().length === 0) {
    return jsonResponse(400, { error: 'invalid_request', message: 'branch is required' })
  }
  if (body.scan_mode !== undefined && !VALID_SCAN_MODES.has(body.scan_mode)) {
    return jsonResponse(400, { error: 'invalid_request', message: 'scan_mode must be one of: commit, full' })
  }

  try {
    const result = await triggerScanUseCase.execute({ repositoryId, branch: body.branch, scanMode: body.scan_mode })
    return jsonResponse(200, {
      scan_id: result.scanId,
      ...(result.repositoryIdWarning !== undefined ? { warning: result.repositoryIdWarning } : {})
    })
  } catch (error) {
    if (error instanceof RepoNotFoundError) {
      return jsonResponse(404, { error: 'not_found' })
    }
    if (error instanceof UnsupportedProviderError) {
      return jsonResponse(422, { error: 'unsupported_provider', message: error.message })
    }
    if (error instanceof RepoUrlInvalidError) {
      return jsonResponse(422, { error: 'invalid_repository_url', message: error.message })
    }
    if (error instanceof ConfigMissingError) {
      return jsonResponse(422, { error: 'config_missing', message: error.message, parameter_id: error.parameterId })
    }
    if (error instanceof BranchResolutionError) {
      return jsonResponse(422, { error: 'branch_resolution_failed', message: error.message })
    }
    if (error instanceof UpstreamScanTriggerError) {
      return jsonResponse(502, { error: 'upstream_error', message: error.message })
    }
    throw error
  }
}

/**
 * `GET /api/admin/repos/:id/default-branch` — admin-only (it exists solely
 * to pre-fill the admin-only "Run scan" dialog's branch field with
 * something better than a hardcoded `"main"` guess). Same error mapping as
 * `handleTriggerScan` for the errors both can throw.
 */
export async function handleGetDefaultBranch (
  getDefaultBranchUseCase: GetDefaultBranchUseCase,
  repositoryId: string,
  session: ValidatedSession
): Promise<APIGatewayProxyStructuredResultV2> {
  if (session.role !== 'admin') {
    return jsonResponse(403, { error: 'forbidden' })
  }

  try {
    const result = await getDefaultBranchUseCase.execute(repositoryId)
    return jsonResponse(200, { branch: result.branch })
  } catch (error) {
    if (error instanceof RepoNotFoundError) {
      return jsonResponse(404, { error: 'not_found' })
    }
    if (error instanceof UnsupportedProviderError) {
      return jsonResponse(422, { error: 'unsupported_provider', message: error.message })
    }
    if (error instanceof RepoUrlInvalidError) {
      return jsonResponse(422, { error: 'invalid_repository_url', message: error.message })
    }
    if (error instanceof ConfigMissingError) {
      return jsonResponse(422, { error: 'config_missing', message: error.message, parameter_id: error.parameterId })
    }
    if (error instanceof BranchResolutionError) {
      return jsonResponse(422, { error: 'branch_resolution_failed', message: error.message })
    }
    throw error
  }
}
