resource "awscc_lambda_web_function" "pilot" {
  function_name = local.name
  tags = [
    { key = "Project", value = local.name },
    { key = "Environment", value = "isolated-pilot" }
  ]
}

# Lambda reads code using its service principal, not the execution role.
# The function has no dependency on this bucket, so this introduces no cycle.
resource "aws_s3_bucket_policy" "artifact" {
  bucket = aws_s3_bucket.artifact.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PilotLambdaArtifactRead"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = ["s3:GetObject", "s3:GetObjectVersion"]
      Resource  = "${aws_s3_bucket.artifact.arn}/${aws_s3_object.artifact.key}"
      Condition = {
        StringEquals = { "aws:SourceAccount" = var.account_id }
        ArnEquals    = { "aws:SourceArn" = awscc_lambda_web_function.pilot.function_arn }
      }
    }]
  })
}

resource "awscc_lambda_web_function_revision" "pilot" {
  function_name = awscc_lambda_web_function.pilot.function_name
  build_config = {
    code_config = {
      s3_object = {
        bucket     = aws_s3_bucket.artifact.id
        key        = aws_s3_object.artifact.key
        version_id = aws_s3_object.artifact.version_id
      }
    }
    runtime_config = { runtime = "nodejs24.x" }
  }
  service_config = {
    execution_role_arn              = aws_iam_role.runtime.arn
    max_concurrency_per_environment = 1
    timeout_seconds                 = 30
    environment_variables = {
      AWS_LAMBDA_NODEJS_ENTRYPOINT = "index.mjs"
      AWS_STAGE                    = "web-functions-pilot"
      LOG_LEVEL                    = "info"
      USER_TABLE_NAME              = aws_dynamodb_table.user.name
      SESSION_TABLE_NAME           = aws_dynamodb_table.session.name
      PARAMETER_TABLE_NAME         = aws_dynamodb_table.parameter.name
      JWT_SECRET_NAME              = aws_secretsmanager_secret.jwt.name
      ENCRYPTION_KEY_NAME          = aws_secretsmanager_secret.aes.name
      REPOSITORY_TABLE_NAME        = "${local.name}-unavailable-repository"
      TASK_TABLE_NAME              = "${local.name}-unavailable-task"
      APIKEY_TABLE_NAME            = "${local.name}-unavailable-apikey"
      TASK_TRIGGER_API_URL         = "https://web-functions-pilot.invalid"
    }
    telemetry_config = {
      logging_config = {
        application_log_level = "INFO"
        system_log_level      = "INFO"
        log_group             = aws_cloudwatch_log_group.runtime.name
      }
    }
  }

  depends_on = [aws_s3_bucket_policy.artifact, aws_iam_role_policy.runtime]
}

resource "awscc_lambda_web_function_endpoint" "pilot" {
  function_name = awscc_lambda_web_function.pilot.function_name
  endpoint_name = "pilot"
  endpoint_type = "HomeRegion"
  auth_type     = "IamAuth"
  revision_weights = [{
    revision_id = awscc_lambda_web_function_revision.pilot.revision_id
    weight      = 100
  }]
  scaling_config  = { max_environments = 2 }
  throttle_config = { rate_limit = 100 }
}

resource "awscc_lambda_resource_policy" "cloudfront" {
  resource_arn = awscc_lambda_web_function.pilot.function_arn
  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PilotCloudFrontInvoke"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "lambda:InvokeWebFunctionEndpoint"
      Resource  = awscc_lambda_web_function_endpoint.pilot.endpoint_arn
      Condition = {
        ArnEquals = { "aws:SourceArn" = aws_cloudfront_distribution.api.arn }
      }
    }]
  })
}
