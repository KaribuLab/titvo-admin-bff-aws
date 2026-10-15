terraform {
  required_version = ">= 1.9.0, < 2.0.0"

  # Deliberately local state; never inherit the production backend.
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.69.0"
    }
    awscc = {
      source  = "hashicorp/awscc"
      version = "= 1.106.0"
    }
  }
}

provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]

  assume_role {
    role_arn     = var.pilot_deployment_role_arn
    session_name = "titvo-web-functions-pilot"
  }

  default_tags {
    tags = {
      Project     = "titvo-web-functions-pilot"
      Environment = "isolated-pilot"
    }
  }
}

# awscc has no allowed_account_ids; the validated role ARN pins its account.
provider "awscc" {
  region = var.region
  assume_role = {
    role_arn     = var.pilot_deployment_role_arn
    session_name = "titvo-web-functions-pilot"
  }
}
