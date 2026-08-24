locals {
  region        = get_env("AWS_REGION")
  stage         = get_env("AWS_STAGE")
  account_id    = get_env("AWS_ACCOUNT_ID", "")
  bucket_suffix = local.account_id == "" ? "" : "-${local.account_id}"
  stages = {
    test = {
      name = "Testing"
    },
    localstack = {
      name = "Localstack"
    },
    prod = {
      name = "Production"
    }
  }
  provider_version = "6.46.0"
  service_name     = "tvo-admin-bff"
  service_bucket   = "${local.service_name}-${local.region}${local.bucket_suffix}"
  parameter_path   = "/tvo/security-scan"
  tags_file_path   = "${get_terragrunt_dir()}/common_tags.json"
  log_retention    = 7
  common_tags = merge(fileexists(local.tags_file_path) ? jsondecode(file(local.tags_file_path)) : {}, {
    Project = "Titvo"
  })
}
