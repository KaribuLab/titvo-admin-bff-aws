import axios from 'axios'
import { TaskTriggerClient, RunScanPayload, RunScanResult } from '@core/scan/task-trigger.client'
import { UpstreamScanTriggerError } from '@app/scan/scan-trigger.error'

interface RunScanResponse {
  message: string
  scan_id: string
}

/**
 * Calls `POST {baseUrl}/run-scan` on titvo-task-trigger-aws — the SAME
 * endpoint GitHub Actions/Bitbucket Pipelines already call, authenticated
 * the SAME way (`X-API-Key`). `baseUrl` is titvo-task-trigger-aws's `task`
 * API Gateway invoke URL, published to the shared `/tvo/security-scan/<stage>`
 * SSM namespace by titvo-security-scan-infra-aws
 * (`infra/apigateway/task/api_gateway_api_full_endpoint`) and wired into
 * this Lambda's environment as `TASK_TRIGGER_API_URL` (see
 * `aws/lambda/terragrunt.hcl`).
 *
 * The upstream response body is never relayed verbatim to callers — only a
 * sanitized `UpstreamScanTriggerError` message, since it may otherwise echo
 * request data.
 */
export class AxiosTaskTriggerClient extends TaskTriggerClient {
  constructor (private readonly baseUrl: string) {
    super()
  }

  async runScan (apiKey: string, payload: RunScanPayload): Promise<RunScanResult> {
    try {
      const response = await axios.post<RunScanResponse>(
        `${this.baseUrl}/run-scan`,
        { source: payload.source, args: payload.args },
        {
          headers: {
            'X-Api-Key': apiKey,
            'Content-Type': 'application/json'
          }
        }
      )
      return { scanId: response.data.scan_id, message: response.data.message }
    } catch {
      throw new UpstreamScanTriggerError('Failed to trigger scan on the task-trigger service')
    }
  }
}
