# Task 3.1 verification note: `KaribuLab/terraform-aws-api-gateway//function-route@v1.0.0`
# (function-route/main.tf) builds `aws_apigatewayv2_route.route_key` as a raw
# string interpolation of `"${method} ${path}"` with no validation on either
# value — it is a pure passthrough to the AWS API Gateway v2 HTTP API route
# resource, which natively accepts `ANY` as a method and `{proxy+}` as a
# greedy path segment in `route_key`. Verified by cloning the module at tag
# v1.0.0 and reading `function-route/main.tf` + `input.tf` directly (no
# method/path allow-list exists in the module). This resolves design.md's
# open question: greedy/ANY support IS present, so per D2's own fallback
# ("if it is supported, collapse to one `{proxy+}` entry") this file uses a
# single enumerated route rather than one entry per future CRUD path.
terraform {
  source = "git::https://github.com/KaribuLab/terraform-aws-api-gateway.git//function-route?ref=v1.0.0"
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

# Attaches to the existing, previously route-free `account` API Gateway
# (design D1) — NOT the `task` gateway used by titvo-auth-setup-aws's CI
# path. No changes to titvo-security-scan-infra-aws are required; the
# gateway shell already exists and exports its ID to SSM.
dependency parameters {
  config_path = "${get_parent_terragrunt_dir()}/aws/parameter"
  mock_outputs = {
    parameters = {
      "${local.base_path}/infra/apigateway/account/api_gateway_id" = "api-gateway-account-id"
    }
  }
}

dependency lambda {
  config_path = "${get_parent_terragrunt_dir()}/aws/lambda"
  mock_outputs = {
    function_name = "function_name"
  }
}

inputs = {
  api_gateway_id = dependency.parameters.outputs.parameters["${local.base_path}/infra/apigateway/account/api_gateway_id"]
  routes = [
    {
      path          = "/api/admin/{proxy+}"
      method        = "ANY"
      function_name = dependency.lambda.outputs.function_name
    }
  ]
  common_tags = local.common_tags
}
