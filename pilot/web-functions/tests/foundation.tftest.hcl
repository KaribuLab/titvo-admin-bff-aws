# Provider-mocked checks only. Supply an existing ZIP using -var; Terraform's
# file hashing still reads the local artifact even when AWS is mocked.
mock_provider "aws" {
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/titvo-web-functions-pilot-runtime" }
  }
  mock_resource "aws_cloudfront_distribution" {
    defaults = {
      arn         = "arn:aws:cloudfront::123456789012:distribution/PILOT"
      domain_name = "pilot.cloudfront.net"
    }
  }
  mock_data "aws_cloudfront_origin_request_policy" {
    defaults = { id = "b689b0a8-53d0-40ab-baf2-68738e2966ac" }
  }
}

mock_provider "awscc" {
  mock_resource "awscc_lambda_web_function" {
    defaults = { function_arn = "arn:aws:lambda:us-east-1:123456789012:web-function:titvo-web-functions-pilot" }
  }
  mock_resource "awscc_lambda_web_function_endpoint" {
    defaults = {
      domain_name  = "pilot.lambda-web.us-east-1.on.aws"
      endpoint_arn = "arn:aws:lambda:us-east-1:123456789012:web-function:titvo-web-functions-pilot:endpoint:pilot"
    }
  }
}

variables {
  account_id                = "123456789012"
  region                    = "us-east-1"
  pilot_deployment_role_arn = "arn:aws:iam::123456789012:role/pilot-deployment"
}

run "isolated_foundation" {
  command = plan

  assert {
    condition = (
      aws_dynamodb_table.user.hash_key == "user_id" &&
      aws_dynamodb_table.session.hash_key == "session_id" &&
      aws_dynamodb_table.parameter.hash_key == "parameter_id" &&
      aws_dynamodb_table.user.billing_mode == "PAY_PER_REQUEST" &&
      aws_dynamodb_table.session.billing_mode == "PAY_PER_REQUEST" &&
      aws_dynamodb_table.parameter.billing_mode == "PAY_PER_REQUEST"
    )
    error_message = "Pilot tables must retain their dedicated keys and on-demand billing."
  }

  assert {
    condition = anytrue([
      for index in aws_dynamodb_table.user.global_secondary_index :
      index.name == "EmailIndex" && index.hash_key == "email" && index.projection_type == "ALL"
    ])
    error_message = "Login requires the dedicated EmailIndex."
  }

  assert {
    condition = anytrue([
      for ttl in aws_dynamodb_table.session.ttl :
      ttl.enabled && ttl.attribute_name == "ttl"
    ])
    error_message = "Sessions must expire using the ttl attribute."
  }

  assert {
    condition = (
      aws_s3_bucket.artifact.force_destroy == false &&
      aws_s3_bucket_public_access_block.artifact.block_public_acls &&
      aws_s3_bucket_public_access_block.artifact.block_public_policy &&
      aws_s3_bucket_public_access_block.artifact.ignore_public_acls &&
      aws_s3_bucket_public_access_block.artifact.restrict_public_buckets &&
      one(aws_s3_bucket_versioning.artifact.versioning_configuration).status == "Enabled"
    )
    error_message = "Artifacts must be private, versioned, and protected against force destruction."
  }

  assert {
    condition = (
      aws_secretsmanager_secret.jwt.recovery_window_in_days == 30 &&
      aws_secretsmanager_secret.aes.recovery_window_in_days == 30
    )
    error_message = "Empty pilot secret containers must retain a recovery window."
  }
}

# Both providers are mocked. This is an in-memory test apply, not AWS apply.
run "protected_wiring" {
  command = apply

  assert {
    condition = (
      awscc_lambda_web_function_revision.pilot.function_name == awscc_lambda_web_function.pilot.function_name &&
      awscc_lambda_web_function_revision.pilot.build_config.code_config.s3_object.version_id == aws_s3_object.artifact.version_id &&
      awscc_lambda_web_function_revision.pilot.build_config.runtime_config.runtime == "nodejs24.x" &&
      awscc_lambda_web_function_revision.pilot.service_config.execution_role_arn == aws_iam_role.runtime.arn &&
      awscc_lambda_web_function_revision.pilot.service_config.max_concurrency_per_environment == 1 &&
      awscc_lambda_web_function_revision.pilot.service_config.telemetry_config.logging_config.log_group == aws_cloudwatch_log_group.runtime.name
    )
    error_message = "Revision must use the versioned pilot artifact, role, runtime and log group."
  }

  assert {
    condition = (
      awscc_lambda_web_function_endpoint.pilot.auth_type == "IamAuth" &&
      awscc_lambda_web_function_endpoint.pilot.endpoint_type == "HomeRegion" &&
      one(awscc_lambda_web_function_endpoint.pilot.revision_weights).revision_id == awscc_lambda_web_function_revision.pilot.revision_id &&
      one(awscc_lambda_web_function_endpoint.pilot.revision_weights).weight == 100 &&
      awscc_lambda_web_function_endpoint.pilot.scaling_config.max_environments == 2 &&
      awscc_lambda_web_function_endpoint.pilot.throttle_config.rate_limit == 100
    )
    error_message = "Endpoint must remain IAM-only, regional, bounded and pinned to the pilot revision."
  }

  assert {
    condition = (
      awscc_lambda_web_function_revision.pilot.service_config.environment_variables["AWS_LAMBDA_NODEJS_ENTRYPOINT"] == "index.mjs" &&
      awscc_lambda_web_function_revision.pilot.service_config.environment_variables["AWS_STAGE"] == "web-functions-pilot" &&
      awscc_lambda_web_function_revision.pilot.service_config.environment_variables["LOG_LEVEL"] == "info" &&
      awscc_lambda_web_function_revision.pilot.service_config.environment_variables["REPOSITORY_TABLE_NAME"] == "titvo-web-functions-pilot-unavailable-repository" &&
      awscc_lambda_web_function_revision.pilot.service_config.environment_variables["TASK_TABLE_NAME"] == "titvo-web-functions-pilot-unavailable-task" &&
      awscc_lambda_web_function_revision.pilot.service_config.environment_variables["APIKEY_TABLE_NAME"] == "titvo-web-functions-pilot-unavailable-apikey" &&
      awscc_lambda_web_function_revision.pilot.service_config.environment_variables["USER_TABLE_NAME"] == aws_dynamodb_table.user.name &&
      awscc_lambda_web_function_revision.pilot.service_config.environment_variables["SESSION_TABLE_NAME"] == aws_dynamodb_table.session.name &&
      awscc_lambda_web_function_revision.pilot.service_config.environment_variables["PARAMETER_TABLE_NAME"] == aws_dynamodb_table.parameter.name &&
      awscc_lambda_web_function_revision.pilot.service_config.environment_variables["JWT_SECRET_NAME"] == aws_secretsmanager_secret.jwt.name &&
      awscc_lambda_web_function_revision.pilot.service_config.environment_variables["ENCRYPTION_KEY_NAME"] == aws_secretsmanager_secret.aes.name &&
      awscc_lambda_web_function_revision.pilot.service_config.environment_variables["TASK_TRIGGER_API_URL"] == "https://web-functions-pilot.invalid"
    )
    error_message = "Runtime must use only pilot resources and an inert scan-trigger URL."
  }

  assert {
    condition = (
      aws_cloudfront_origin_access_control.api.origin_access_control_origin_type == "lambda" &&
      aws_cloudfront_origin_access_control.api.signing_behavior == "always-amz-auth" &&
      aws_cloudfront_origin_access_control.api.signing_protocol == "sigv4" &&
      one(aws_cloudfront_distribution.api.origin).domain_name == awscc_lambda_web_function_endpoint.pilot.domain_name &&
      one(aws_cloudfront_distribution.api.origin).origin_access_control_id == aws_cloudfront_origin_access_control.api.id &&
      one(one(aws_cloudfront_distribution.api.origin).custom_origin_config).origin_protocol_policy == "https-only" &&
      (one(aws_cloudfront_distribution.api.origin).origin_path == null || one(aws_cloudfront_distribution.api.origin).origin_path == "") &&
      length(aws_cloudfront_distribution.api.custom_error_response) == 0 &&
      length(coalesce(aws_cloudfront_distribution.api.aliases, toset([]))) == 0
    )
    error_message = "CloudFront must use the signed HTTPS pilot origin without path prefixes, rewrites or custom domains."
  }

  assert {
    condition = (
      aws_cloudfront_cache_policy.api.min_ttl == 0 &&
      aws_cloudfront_cache_policy.api.default_ttl == 0 &&
      aws_cloudfront_cache_policy.api.max_ttl == 0 &&
      toset(one(one(one(aws_cloudfront_cache_policy.api.parameters_in_cache_key_and_forwarded_to_origin).headers_config).headers).items) == toset(["Authorization"]) &&
      aws_cloudfront_distribution.api.default_cache_behavior[0].viewer_protocol_policy == "redirect-to-https" &&
      aws_cloudfront_distribution.api.default_cache_behavior[0].cache_policy_id == aws_cloudfront_cache_policy.api.id &&
      aws_cloudfront_distribution.api.default_cache_behavior[0].origin_request_policy_id == data.aws_cloudfront_origin_request_policy.viewer.id &&
      toset(aws_cloudfront_distribution.api.default_cache_behavior[0].allowed_methods) == toset(["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"])
    )
    error_message = "API must disable caching and preserve Authorization, viewer cookies/query/headers and all methods."
  }

  assert {
    condition = (
      awscc_lambda_resource_policy.cloudfront.resource_arn == awscc_lambda_web_function.pilot.function_arn &&
      length(jsondecode(awscc_lambda_resource_policy.cloudfront.policy_document).Statement) == 1 &&
      jsondecode(awscc_lambda_resource_policy.cloudfront.policy_document).Statement[0].Principal.Service == "cloudfront.amazonaws.com" &&
      jsondecode(awscc_lambda_resource_policy.cloudfront.policy_document).Statement[0].Action == "lambda:InvokeWebFunctionEndpoint" &&
      jsondecode(awscc_lambda_resource_policy.cloudfront.policy_document).Statement[0].Resource == awscc_lambda_web_function_endpoint.pilot.endpoint_arn &&
      jsondecode(awscc_lambda_resource_policy.cloudfront.policy_document).Statement[0].Condition.ArnEquals["aws:SourceArn"] == aws_cloudfront_distribution.api.arn
    )
    error_message = "Invoke policy must attach to the function and permit only this distribution to invoke this endpoint."
  }

  assert {
    condition = (
      length(jsondecode(aws_s3_bucket_policy.artifact.policy).Statement) == 1 &&
      jsondecode(aws_s3_bucket_policy.artifact.policy).Statement[0].Principal.Service == "lambda.amazonaws.com" &&
      toset(jsondecode(aws_s3_bucket_policy.artifact.policy).Statement[0].Action) == toset(["s3:GetObject", "s3:GetObjectVersion"]) &&
      jsondecode(aws_s3_bucket_policy.artifact.policy).Statement[0].Resource == "${aws_s3_bucket.artifact.arn}/${aws_s3_object.artifact.key}" &&
      jsondecode(aws_s3_bucket_policy.artifact.policy).Statement[0].Condition.StringEquals["aws:SourceAccount"] == var.account_id &&
      jsondecode(aws_s3_bucket_policy.artifact.policy).Statement[0].Condition.ArnEquals["aws:SourceArn"] == awscc_lambda_web_function.pilot.function_arn
    )
    error_message = "Artifact read must be scoped to Lambda, this object, account and function."
  }

  assert {
    condition = (
      length(jsondecode(aws_iam_role_policy.runtime.policy).Statement) == 5 &&
      toset(jsondecode(aws_iam_role_policy.runtime.policy).Statement[2].Action) == toset(["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"]) &&
      jsondecode(aws_iam_role_policy.runtime.policy).Statement[2].Resource == aws_dynamodb_table.session.arn &&
      toset(jsondecode(aws_iam_role_policy.runtime.policy).Statement[1].Action) == toset(["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"]) &&
      toset(jsondecode(aws_iam_role_policy.runtime.policy).Statement[3].Action) == toset(["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"]) &&
      jsondecode(aws_iam_role_policy.runtime.policy).Statement[4].Action == ["secretsmanager:GetSecretValue"] &&
      toset(jsondecode(aws_iam_role_policy.runtime.policy).Statement[0].Action) == toset(["logs:CreateLogStream", "logs:PutLogEvents"]) &&
      jsondecode(aws_iam_role_policy.runtime.policy).Statement[0].Resource == "${aws_cloudwatch_log_group.runtime.arn}:*" &&
      toset(jsondecode(aws_iam_role_policy.runtime.policy).Statement[1].Resource) == toset([aws_dynamodb_table.user.arn, "${aws_dynamodb_table.user.arn}/index/EmailIndex"]) &&
      jsondecode(aws_iam_role_policy.runtime.policy).Statement[3].Resource == aws_dynamodb_table.parameter.arn &&
      toset(jsondecode(aws_iam_role_policy.runtime.policy).Statement[4].Resource) == toset([aws_secretsmanager_secret.jwt.arn, aws_secretsmanager_secret.aes.arn])
    )
    error_message = "Session lifecycle permission must remain intact without user/config writes or extra grants."
  }
}

run "reject_cross_account_role" {
  command = plan
  variables {
    pilot_deployment_role_arn = "arn:aws:iam::999999999999:role/not-the-pilot-account"
  }
  expect_failures = [var.pilot_deployment_role_arn]
}

run "reject_unannounced_region" {
  command = plan
  variables {
    region = "eu-central-1"
  }
  expect_failures = [var.region]
}
