output "resource_names" {
  description = "Pilot resource names only; no secret values."
  value = {
    user_table      = aws_dynamodb_table.user.name
    session_table   = aws_dynamodb_table.session.name
    parameter_table = aws_dynamodb_table.parameter.name
    jwt_secret      = aws_secretsmanager_secret.jwt.name
    aes_secret      = aws_secretsmanager_secret.aes.name
    artifact_bucket = aws_s3_bucket.artifact.id
    runtime_role    = aws_iam_role.runtime.name
    log_group       = aws_cloudwatch_log_group.runtime.name
    web_function    = awscc_lambda_web_function.pilot.function_name
    endpoint        = awscc_lambda_web_function_endpoint.pilot.endpoint_name
  }
}

output "pilot_url" {
  description = "Isolated CloudFront API URL; authentication requires separately approved data preparation."
  value       = "https://${aws_cloudfront_distribution.api.domain_name}"
  depends_on  = [awscc_lambda_resource_policy.cloudfront]
}
