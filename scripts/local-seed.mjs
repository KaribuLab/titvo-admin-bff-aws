#!/usr/bin/env node
/**
 * Seeds the LocalStack stack (docker-compose.local.yml) with everything
 * titvo-admin-bff-aws + titvo-auth need to run locally: the 3 DynamoDB
 * tables (user, session, config), the AES key + JWT secret in Secrets
 * Manager, and one admin user so you can actually log in.
 *
 * Uses the AWS SDK directly (already a dependency of this repo) instead of
 * the aws-cli, so there's nothing extra to install. Idempotent — safe to
 * re-run; existing tables/secrets/the admin user are left alone.
 *
 * Usage: node scripts/local-seed.mjs
 * Requires: docker compose -f docker-compose.local.yml up -d (already running)
 */
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  UpdateTimeToLiveCommand,
  PutItemCommand,
  QueryCommand,
  ResourceNotFoundException
} from '@aws-sdk/client-dynamodb'
import {
  SecretsManagerClient,
  CreateSecretCommand,
  ResourceExistsException
} from '@aws-sdk/client-secrets-manager'
import { randomBytes, randomUUID } from 'node:crypto'
import bcryptjs from 'bcryptjs'

const ENDPOINT = process.env.AWS_ENDPOINT ?? 'http://localhost:4566'
const REGION = process.env.AWS_REGION ?? 'us-east-1'

const USER_TABLE = process.env.USER_TABLE_NAME ?? 'user'
const SESSION_TABLE = process.env.SESSION_TABLE_NAME ?? 'session'
const PARAMETER_TABLE = process.env.PARAMETER_TABLE_NAME ?? 'tvo-security-scan-parameter-prod'
const REPOSITORY_TABLE = process.env.REPOSITORY_TABLE_NAME ?? 'repository'
const TASK_TABLE = process.env.TASK_TABLE_NAME ?? 'task'
const APIKEY_TABLE = process.env.APIKEY_TABLE_NAME ?? 'apikey'

const ENCRYPTION_KEY_NAME = process.env.ENCRYPTION_KEY_NAME ?? '/tvo/local/aes_secret'
const JWT_SECRET_NAME = process.env.JWT_SECRET_NAME ?? '/tvo/local/jwt_secret'

const ADMIN_EMAIL = process.env.LOCAL_ADMIN_EMAIL ?? 'admin@titvo.local'
const ADMIN_PASSWORD = process.env.LOCAL_ADMIN_PASSWORD ?? 'admin12345'
const BCRYPT_COST = 10 // matches titvo-auth's PasswordHasherService (SALT_ROUNDS = 10)

const clientConfig = {
  endpoint: ENDPOINT,
  region: REGION,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' }
}

const dynamo = new DynamoDBClient(clientConfig)
const secrets = new SecretsManagerClient(clientConfig)

async function tableExists (tableName) {
  try {
    await dynamo.send(new DescribeTableCommand({ TableName: tableName }))
    return true
  } catch (error) {
    if (error instanceof ResourceNotFoundException) return false
    throw error
  }
}

async function ensureUserTable () {
  if (await tableExists(USER_TABLE)) {
    console.log(`[seed] Table '${USER_TABLE}' already exists, skipping.`)
    return
  }
  console.log(`[seed] Creating table '${USER_TABLE}' (PK user_id, GSI EmailIndex on email)...`)
  await dynamo.send(new CreateTableCommand({
    TableName: USER_TABLE,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'user_id', AttributeType: 'S' },
      { AttributeName: 'email', AttributeType: 'S' }
    ],
    KeySchema: [{ AttributeName: 'user_id', KeyType: 'HASH' }],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'EmailIndex',
        KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' }
      }
    ]
  }))
}

async function ensureSessionTable () {
  if (await tableExists(SESSION_TABLE)) {
    console.log(`[seed] Table '${SESSION_TABLE}' already exists, skipping.`)
    return
  }
  console.log(`[seed] Creating table '${SESSION_TABLE}' (PK session_id, TTL on 'ttl')...`)
  await dynamo.send(new CreateTableCommand({
    TableName: SESSION_TABLE,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [{ AttributeName: 'session_id', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'session_id', KeyType: 'HASH' }]
  }))
  // LocalStack accepts this even though actual TTL expiry enforcement in
  // LocalStack's community edition is best-effort/not guaranteed — fine for
  // local testing, session expiry is also enforced by JWT exp regardless.
  await dynamo.send(new UpdateTimeToLiveCommand({
    TableName: SESSION_TABLE,
    TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true }
  })).catch((error) => {
    console.warn(`[seed] Could not enable TTL on '${SESSION_TABLE}' (non-fatal for local testing): ${error.message}`)
  })
}

async function ensureParameterTable () {
  if (await tableExists(PARAMETER_TABLE)) {
    console.log(`[seed] Table '${PARAMETER_TABLE}' already exists, skipping.`)
    return
  }
  console.log(`[seed] Creating table '${PARAMETER_TABLE}' (PK parameter_id)...`)
  await dynamo.send(new CreateTableCommand({
    TableName: PARAMETER_TABLE,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [{ AttributeName: 'parameter_id', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'parameter_id', KeyType: 'HASH' }]
  }))
}

async function ensureRepositoryTable () {
  if (await tableExists(REPOSITORY_TABLE)) {
    console.log(`[seed] Table '${REPOSITORY_TABLE}' already exists, skipping.`)
    return
  }
  console.log(`[seed] Creating table '${REPOSITORY_TABLE}' (PK repository_id, GSI user_id_gsi)...`)
  await dynamo.send(new CreateTableCommand({
    TableName: REPOSITORY_TABLE,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'repository_id', AttributeType: 'S' },
      { AttributeName: 'user_id', AttributeType: 'S' }
    ],
    KeySchema: [{ AttributeName: 'repository_id', KeyType: 'HASH' }],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'user_id_gsi',
        KeySchema: [{ AttributeName: 'user_id', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' }
      }
    ]
  }))
}

async function ensureTaskTable () {
  if (await tableExists(TASK_TABLE)) {
    console.log(`[seed] Table '${TASK_TABLE}' already exists, skipping.`)
    return
  }
  console.log(`[seed] Creating table '${TASK_TABLE}' (PK scan_id, GSI repository_id_index)...`)
  await dynamo.send(new CreateTableCommand({
    TableName: TASK_TABLE,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'scan_id', AttributeType: 'S' },
      { AttributeName: 'repository_id', AttributeType: 'S' },
      { AttributeName: 'created_at', AttributeType: 'S' }
    ],
    KeySchema: [{ AttributeName: 'scan_id', KeyType: 'HASH' }],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'repository_id_index',
        KeySchema: [
          { AttributeName: 'repository_id', KeyType: 'HASH' },
          { AttributeName: 'created_at', KeyType: 'RANGE' }
        ],
        Projection: {
          ProjectionType: 'INCLUDE',
          NonKeyAttributes: ['status', 'source', 'branch', 'updated_at', 'job_id']
        }
      }
    ]
  }))
}

async function ensureApiKeyTable () {
  if (await tableExists(APIKEY_TABLE)) {
    console.log(`[seed] Table '${APIKEY_TABLE}' already exists, skipping.`)
    return
  }
  console.log(`[seed] Creating table '${APIKEY_TABLE}' (PK key_id, GSIs user_id_gsi/api_key_gsi)...`)
  await dynamo.send(new CreateTableCommand({
    TableName: APIKEY_TABLE,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'key_id', AttributeType: 'S' },
      { AttributeName: 'user_id', AttributeType: 'S' },
      { AttributeName: 'api_key', AttributeType: 'S' }
    ],
    KeySchema: [{ AttributeName: 'key_id', KeyType: 'HASH' }],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'user_id_gsi',
        KeySchema: [{ AttributeName: 'user_id', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' }
      },
      {
        IndexName: 'api_key_gsi',
        KeySchema: [{ AttributeName: 'api_key', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' }
      }
    ]
  }))
}

async function ensureSecret (name, valueFn) {
  try {
    await secrets.send(new CreateSecretCommand({ Name: name, SecretString: valueFn() }))
    console.log(`[seed] Created secret '${name}'.`)
  } catch (error) {
    if (error instanceof ResourceExistsException) {
      console.log(`[seed] Secret '${name}' already exists, skipping.`)
      return
    }
    throw error
  }
}

async function findUserIdByEmail (email) {
  const result = await dynamo.send(new QueryCommand({
    TableName: USER_TABLE,
    IndexName: 'EmailIndex',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': { S: email } }
  }))
  return result.Items?.[0]?.user_id?.S
}

async function ensureAdminUser () {
  const existingUserId = await findUserIdByEmail(ADMIN_EMAIL)
  if (existingUserId !== undefined) {
    console.log(`[seed] Admin user already exists, skipping: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
    return existingUserId
  }

  const passwordHash = await bcryptjs.hash(ADMIN_PASSWORD, BCRYPT_COST)
  const now = new Date().toISOString()
  const userId = randomUUID()

  await dynamo.send(new PutItemCommand({
    TableName: USER_TABLE,
    Item: {
      user_id: { S: userId },
      email: { S: ADMIN_EMAIL },
      password_hash: { S: passwordHash },
      role: { S: 'admin' },
      created_at: { S: now },
      updated_at: { S: now }
    }
  }))
  console.log(`[seed] Admin user ready: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
  return userId
}

async function ensureSampleRepoAndScans (adminUserId) {
  const now = Date.now()
  const repos = [
    { id: 'repo-with-scans', name: 'titvo-rag-indexer', url: 'https://github.com/KaribuLab/titvo-rag-indexer', provider: 'github' },
    { id: 'repo-never-scanned', name: 'titvo-admin-web', url: 'https://github.com/KaribuLab/titvo-admin-web', provider: 'github' }
  ]

  for (const repo of repos) {
    await dynamo.send(new PutItemCommand({
      TableName: REPOSITORY_TABLE,
      Item: {
        repository_id: { S: repo.id },
        user_id: { S: adminUserId },
        name: { S: repo.name },
        url: { S: repo.url },
        provider: { S: repo.provider },
        created_at: { S: new Date(now).toISOString() }
      }
    }))
  }
  console.log(`[seed] Seeded ${repos.length} sample repositories ('${repos[0].id}' has scans, '${repos[1].id}' has none).`)

  const scans = [
    { scanId: 'scan-1-completed', status: 'COMPLETED', offsetMs: 3 * 3600_000 },
    { scanId: 'scan-2-failed', status: 'FAILED', offsetMs: 2 * 3600_000 },
    { scanId: 'scan-3-in-progress', status: 'IN_PROGRESS', offsetMs: 0 }
  ]

  for (const scan of scans) {
    const createdAt = new Date(now - scan.offsetMs).toISOString()
    await dynamo.send(new PutItemCommand({
      TableName: TASK_TABLE,
      Item: {
        scan_id: { S: scan.scanId },
        repository_id: { S: 'repo-with-scans' },
        status: { S: scan.status },
        source: { S: 'github' },
        branch: { S: 'main' },
        job_id: { S: `job-${scan.scanId}` },
        created_at: { S: createdAt },
        updated_at: { S: createdAt },
        args: { M: { branch: { S: 'main' } } }
      }
    }))
  }
  console.log(`[seed] Seeded ${scans.length} sample scans for 'repo-with-scans' (most recent: IN_PROGRESS).`)

  // Orphan scan: repository_id that doesn't resolve to any repository row —
  // exercises the "orphan data resilience" edge case from the spec.
  const orphanCreatedAt = new Date(now - 4 * 3600_000).toISOString()
  await dynamo.send(new PutItemCommand({
    TableName: TASK_TABLE,
    Item: {
      scan_id: { S: 'scan-orphan' },
      repository_id: { S: 'repo-deleted-or-unknown' },
      status: { S: 'COMPLETED' },
      source: { S: 'github' },
      branch: { S: 'main' },
      created_at: { S: orphanCreatedAt },
      updated_at: { S: orphanCreatedAt }
    }
  }))
  console.log('[seed] Seeded 1 orphan scan (repository_id resolves to nothing).')
}

async function main () {
  console.log(`[seed] Seeding LocalStack at ${ENDPOINT}...`)
  await ensureUserTable()
  await ensureSessionTable()
  await ensureParameterTable()
  await ensureRepositoryTable()
  await ensureTaskTable()
  await ensureApiKeyTable()
  await ensureSecret(ENCRYPTION_KEY_NAME, () => randomBytes(32).toString('base64'))
  await ensureSecret(JWT_SECRET_NAME, () => randomBytes(48).toString('base64'))
  const adminUserId = await ensureAdminUser()
  await ensureSampleRepoAndScans(adminUserId)
  console.log('[seed] Done. Start the BFF with `npm run dev` and log in with the admin credentials above.')
}

main().catch((error) => {
  console.error('[seed] Failed:', error)
  process.exitCode = 1
})
