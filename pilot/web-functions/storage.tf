resource "aws_dynamodb_table" "user" {
  name         = "${local.name}-user"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "user_id"

  attribute {
    name = "user_id"
    type = "S"
  }
  attribute {
    name = "email"
    type = "S"
  }
  global_secondary_index {
    name            = "EmailIndex"
    hash_key        = "email"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "session" {
  name         = "${local.name}-session"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "session_id"

  attribute {
    name = "session_id"
    type = "S"
  }
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

resource "aws_dynamodb_table" "parameter" {
  name         = "${local.name}-parameter"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "parameter_id"

  attribute {
    name = "parameter_id"
    type = "S"
  }
}

# Containers only: no secret versions, random passwords, or secret values.
resource "aws_secretsmanager_secret" "jwt" {
  name                    = "${local.name}-jwt"
  recovery_window_in_days = 30
}

resource "aws_secretsmanager_secret" "aes" {
  name                    = "${local.name}-aes"
  recovery_window_in_days = 30
}

resource "aws_s3_bucket" "artifact" {
  bucket        = "${local.name}-${var.account_id}-${var.region}"
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "artifact" {
  bucket                  = aws_s3_bucket.artifact.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "artifact" {
  bucket = aws_s3_bucket.artifact.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "artifact" {
  bucket = aws_s3_bucket.artifact.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifact" {
  bucket = aws_s3_bucket.artifact.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_object" "artifact" {
  bucket      = aws_s3_bucket.artifact.id
  key         = "web-functions-pilot.zip"
  source      = var.artifact_zip_path
  source_hash = filebase64sha256(var.artifact_zip_path)

  depends_on = [
    aws_s3_bucket_versioning.artifact,
    aws_s3_bucket_public_access_block.artifact,
    aws_s3_bucket_ownership_controls.artifact,
    aws_s3_bucket_server_side_encryption_configuration.artifact
  ]
}
