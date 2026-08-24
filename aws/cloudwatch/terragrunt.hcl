terraform {
  source = "git::https://github.com/KaribuLab/terraform-aws-log.git?ref=v0.3.0"
}

locals {
  serverless  = read_terragrunt_config(find_in_parent_folders("serverless.hcl"))
  log_name    = "${local.serverless.locals.service_name}-lambda-${local.serverless.locals.stage}"
  common_tags = local.serverless.locals.common_tags
}

include {
  path = find_in_parent_folders()
}

inputs = {
  log_name          = local.log_name
  retention_in_days = local.serverless.locals.log_retention
  common_tags       = local.common_tags
}
