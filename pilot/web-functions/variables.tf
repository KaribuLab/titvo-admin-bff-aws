variable "account_id" {
  description = "Explicit AWS account approved for the isolated pilot."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must contain exactly 12 digits."
  }
}

variable "pilot_deployment_role_arn" {
  description = "Pre-existing operator-approved deployment role in account_id; both providers assume this role."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:iam::${var.account_id}:role/[A-Za-z0-9+=,.@_/-]+$", var.pilot_deployment_role_arn))
    error_message = "pilot_deployment_role_arn must name an IAM role in account_id."
  }
}

variable "region" {
  description = "Explicit announced Web Functions HomeRegion; no default."
  type        = string

  validation {
    condition = contains([
      "us-east-1", "us-east-2", "us-west-2", "eu-west-1", "ap-northeast-1"
    ], var.region)
    error_message = "region must be an announced Web Functions region."
  }
}

variable "artifact_zip_path" {
  description = "Absolute path to an operator-prepared ZIP containing index.mjs at its root."
  type        = string

  validation {
    condition     = startswith(var.artifact_zip_path, "/") && endswith(var.artifact_zip_path, ".zip")
    error_message = "artifact_zip_path must be an absolute path ending in .zip."
  }
}

locals {
  name = "titvo-web-functions-pilot"
}
