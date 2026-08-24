terraform {
  source = "git::https://github.com/KaribuLab/terraform-aws-function.git?ref=v0.7.0"
}

locals {
  serverless    = read_terragrunt_config(find_in_parent_folders("serverless.hcl"))
  function_name = "${local.serverless.locals.service_name}-lambda-${local.serverless.locals.stage}"
  common_tags   = local.serverless.locals.common_tags
  base_path     = "${local.serverless.locals.parameter_path}/${local.serverless.locals.stage}"
}

include {
  path = find_in_parent_folders()
}

dependency log {
  config_path = "${get_parent_terragrunt_dir()}/aws/cloudwatch"
  mock_outputs = {
    log_arn = "log_arn"
  }
}

# NOTE: extended in the CRUD batch (tasks 3.5-3.14) with the config-table
# (parameter) permissions and the AES secret Get permission. The AES
# secret entries (`secret/manager/arn`, `kms/encryption-key-name`) mirror
# the EXACT existing pattern already used by titvo-auth-setup-aws,
# titvo-task-status-aws, titvo-task-trigger-aws, and titvo-task-cli-files-
# aws (same shared AES key titvo-installer's CLI wizard encrypts with) —
# not a new mechanism.
dependency parameters {
  config_path = "${get_parent_terragrunt_dir()}/aws/parameter"
  mock_outputs = {
    parameters = {
      "${local.base_path}/infra/secret/manager/jwt/arn"       = "arn:aws:secretsmanager:us-east-1:000000000000:secret:/tvo/security-scan/prod/jwt"
      "${local.base_path}/infra/secret/manager/jwt/name"      = "tvo-security-scan-jwt-secret-prod"
      "${local.base_path}/infra/secret/manager/arn"           = "arn:aws:secretsmanager:us-east-1:000000000000:secret:${local.base_path}"
      "${local.base_path}/infra/kms/encryption-key-name"      = "tvo-admin-bff-encryption-key-prod"
      "${local.base_path}/infra/dynamo/user-table-name"       = "tvo-github-security-scan-user-table-prod"
      "${local.base_path}/infra/dynamo/user-table-arn"        = "arn:aws:dynamodb:us-east-1:000000000000:table/tvo-github-security-scan-user-table-prod"
      "${local.base_path}/infra/dynamo/session-table-name"    = "tvo-github-security-scan-session-table-prod"
      "${local.base_path}/infra/dynamo/session-table-arn"     = "arn:aws:dynamodb:us-east-1:000000000000:table/tvo-github-security-scan-session-table-prod"
      "${local.base_path}/infra/dynamo/parameter-table-name"  = "tvo-security-scan-parameter-prod"
      "${local.base_path}/infra/dynamo/parameter-table-arn"   = "arn:aws:dynamodb:us-east-1:000000000000:table/tvo-security-scan-parameter-prod"
      "${local.base_path}/infra/dynamo/task-table-name"       = "tvo-security-scan-task-table-prod"
      "${local.base_path}/infra/dynamo/task-table-arn"        = "arn:aws:dynamodb:us-east-1:000000000000:table/tvo-security-scan-task-table-prod"
      "${local.base_path}/infra/dynamo/repository-table-name" = "tvo-security-scan-repository-table-prod"
      "${local.base_path}/infra/dynamo/repository-table-arn"  = "arn:aws:dynamodb:us-east-1:000000000000:table/tvo-security-scan-repository-table-prod"
      "${local.base_path}/infra/dynamo/apikey-table-name"     = "tvo-security-scan-apikey-table-prod"
      "${local.base_path}/infra/dynamo/apikey-table-arn"      = "arn:aws:dynamodb:us-east-1:000000000000:table/tvo-security-scan-apikey-table-prod"
      # Trigger-a-scan feature: titvo-task-trigger-aws's `task` API Gateway
      # full invoke URL, published to this SAME shared `/tvo/security-scan/<stage>`
      # SSM namespace by titvo-security-scan-infra-aws
      # (prod/us-east-1/ssm/paremeter/upsert — `apigateway/task/api_gateway_api_full_endpoint`).
      # Both `titvo-admin-bff-aws` and `titvo-task-trigger-aws` share this
      # exact `parameter_path` ("/tvo/security-scan"), which is how one
      # service's Terragrunt stack can read another's published output
      # without a cross-repo dependency block.
      "${local.base_path}/infra/apigateway/task/api_gateway_api_full_endpoint" = "https://xyz789ghi012.execute-api.us-east-1.amazonaws.com/v1"
    }
  }
}

inputs = {
  function_name = local.function_name
  iam_policy = jsonencode({
    "Version" : "2012-10-17",
    "Statement" : [
      {
        "Effect" : "Allow",
        "Action" : [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ],
        "Resource" : "${dependency.log.outputs.log_arn}:*"
      },
      # Work Unit 6 (Phase 6, user endpoints): read/write on `user` for
      # list (Scan)/create (PutItem, checked first via the `EmailIndex`
      # Query)/deactivate+role-change (UpdateItem). `GetItem` kept for the
      # existing session-guard read path (`DynamoUserRepository.findById`).
      # The `EmailIndex` ARN is a SEPARATE resource string from the table
      # ARN (same classic silent Query AccessDenied pitfall as the task
      # and apikey GSIs above).
      {
        "Effect" : "Allow",
        "Action" : [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Scan",
          "dynamodb:Query"
        ],
        "Resource" : [
          dependency.parameters.outputs.parameters["${local.base_path}/infra/dynamo/user-table-arn"],
          "${dependency.parameters.outputs.parameters["${local.base_path}/infra/dynamo/user-table-arn"]}/index/EmailIndex"
        ]
      },
      {
        "Effect" : "Allow",
        "Action" : [
          "dynamodb:GetItem",
          "dynamodb:UpdateItem"
        ],
        "Resource" : [
          dependency.parameters.outputs.parameters["${local.base_path}/infra/dynamo/session-table-arn"]
        ]
      },
      {
        "Effect" : "Allow",
        "Action" : [
          "secretsmanager:GetSecretValue"
        ],
        "Resource" : [
          dependency.parameters.outputs.parameters["${local.base_path}/infra/secret/manager/jwt/arn"]
        ]
      },
      {
        "Effect" : "Allow",
        "Action" : [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Scan"
        ],
        "Resource" : [
          dependency.parameters.outputs.parameters["${local.base_path}/infra/dynamo/parameter-table-arn"]
        ]
      },
      {
        "Effect" : "Allow",
        "Action" : [
          "secretsmanager:GetSecretValue"
        ],
        "Resource" : [
          dependency.parameters.outputs.parameters["${local.base_path}/infra/secret/manager/arn"]
        ]
      },
      # Work Unit 4 (Phase 4, repo/scan read endpoints): direct read-only
      # access to `task` (design D1 — no proxy through
      # titvo-task-status-aws) via the new `repository_id_index` GSI
      # (design D2). The index ARN is a SEPARATE resource string from the
      # table ARN — omitting it is the classic silent Query AccessDenied
      # (design "IAM deltas" pitfall note).
      {
        "Effect" : "Allow",
        "Action" : [
          "dynamodb:GetItem",
          "dynamodb:Query"
        ],
        "Resource" : [
          dependency.parameters.outputs.parameters["${local.base_path}/infra/dynamo/task-table-arn"],
          "${dependency.parameters.outputs.parameters["${local.base_path}/infra/dynamo/task-table-arn"]}/index/repository_id_index"
        ]
      },
      # `repository` list (design D3): plain read-only Scan, no new GSI.
      {
        "Effect" : "Allow",
        "Action" : [
          "dynamodb:Scan"
        ],
        "Resource" : [
          dependency.parameters.outputs.parameters["${local.base_path}/infra/dynamo/repository-table-arn"]
        ]
      },
      # Work Unit 5 (Phase 5, api-key endpoints): read/write on `apikey`
      # for list (Scan)/create (PutItem)/revoke+activate-rollback
      # (UpdateItem). `GetItem`/`Query` kept for `ApiKeyRepository`
      # interface completeness (findByUserId/findByApiKey, mirroring
      # titvo-task-trigger-aws's existing repository). `user_id_gsi` and
      # `api_key_gsi` are SEPARATE resource strings from the table ARN
      # (same classic silent Query AccessDenied pitfall as the task GSI
      # above) — `api_key_gsi` was added for the trigger-a-scan feature's
      # repositoryId-mismatch check (`TriggerScanUseCase` now genuinely
      # calls `ValidateApiKeyUseCase.execute()` → `findByApiKey` →
      # `Query` on `api_key_gsi`, the first real caller of that path from
      # this BFF; the original Work Unit 5 grant only covered
      # `user_id_gsi`, which would have silently AccessDenied'd this new
      # call in real AWS had it not been added here too).
      {
        "Effect" : "Allow",
        "Action" : [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Scan",
          "dynamodb:Query"
        ],
        "Resource" : [
          dependency.parameters.outputs.parameters["${local.base_path}/infra/dynamo/apikey-table-arn"],
          "${dependency.parameters.outputs.parameters["${local.base_path}/infra/dynamo/apikey-table-arn"]}/index/user_id_gsi",
          "${dependency.parameters.outputs.parameters["${local.base_path}/infra/dynamo/apikey-table-arn"]}/index/api_key_gsi"
        ]
      }
    ]
  })
  environment_variables = {
    USER_TABLE_NAME       = dependency.parameters.outputs.parameters["${local.base_path}/infra/dynamo/user-table-name"]
    SESSION_TABLE_NAME    = dependency.parameters.outputs.parameters["${local.base_path}/infra/dynamo/session-table-name"]
    JWT_SECRET_NAME       = dependency.parameters.outputs.parameters["${local.base_path}/infra/secret/manager/jwt/name"]
    PARAMETER_TABLE_NAME  = dependency.parameters.outputs.parameters["${local.base_path}/infra/dynamo/parameter-table-name"]
    TASK_TABLE_NAME       = dependency.parameters.outputs.parameters["${local.base_path}/infra/dynamo/task-table-name"]
    REPOSITORY_TABLE_NAME = dependency.parameters.outputs.parameters["${local.base_path}/infra/dynamo/repository-table-name"]
    APIKEY_TABLE_NAME     = dependency.parameters.outputs.parameters["${local.base_path}/infra/dynamo/apikey-table-name"]
    ENCRYPTION_KEY_NAME   = dependency.parameters.outputs.parameters["${local.base_path}/infra/kms/encryption-key-name"]
    # Trigger-a-scan feature: base URL this Lambda calls to invoke
    # titvo-task-trigger-aws's `POST /run-scan` (the handler appends
    # `/run-scan` itself — see `AxiosTaskTriggerClient`). No new IAM
    # permission is needed for this call: this Lambda is NOT deployed
    # inside a VPC (no `vpc_config`/subnet/security-group inputs anywhere
    # in this stack, verified against this file and the
    # `terraform-aws-function` module it sources), so it already has the
    # AWS-managed Lambda execution environment's default internet egress —
    # same as titvo-task-trigger-aws itself, also non-VPC. This is this
    # Lambda's first outbound call in CODE, but not the first time its
    # network environment has supported one.
    TASK_TRIGGER_API_URL  = dependency.parameters.outputs.parameters["${local.base_path}/infra/apigateway/task/api_gateway_api_full_endpoint"]
    AWS_STAGE             = local.serverless.locals.stage
    LOG_LEVEL             = "debug"
  }
  runtime       = "nodejs20.x"
  handler       = "src/entrypoint.handler"
  bucket        = local.serverless.locals.service_bucket
  file_location = "${get_parent_terragrunt_dir()}/build"
  zip_location  = "${get_parent_terragrunt_dir()}/dist"
  zip_name      = "${local.function_name}.zip"
  common_tags   = local.common_tags
}
