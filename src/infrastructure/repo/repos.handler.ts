import { APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { ListReposUseCase, RepoListItem } from '@app/repo/list-repos.use-case'
import { jsonResponse } from '../../utils/http-responses'

function toWireShape (item: RepoListItem): Record<string, unknown> {
  return {
    repository_id: item.repositoryId,
    name: item.name,
    url: item.url,
    provider: item.provider,
    last_scan: item.lastScan === null
      ? null
      : {
          scan_id: item.lastScan.scanId,
          status: item.lastScan.status,
          execution_status: item.lastScan.executionStatus,
          created_at: item.lastScan.createdAt
        }
  }
}

/**
 * `GET /api/admin/repos` — session-guarded, no role check (spec: repo
 * visibility is read-accessible to `member` and `admin` alike). Spec: no
 * repos ⇒ explicit empty state `{items:[]}`; a repo that has never been
 * scanned ⇒ `last_scan:null` — neither is an error.
 */
export async function handleListRepos (listReposUseCase: ListReposUseCase): Promise<APIGatewayProxyStructuredResultV2> {
  const items = await listReposUseCase.execute()
  return jsonResponse(200, { items: items.map(toWireShape) })
}
