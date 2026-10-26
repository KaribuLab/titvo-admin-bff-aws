import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { parse } = require('yaml')
const path = resolve('.github/workflows/deploy-to-aws.yml')
const workflow = existsSync(path) ? parse(readFileSync(path, 'utf8')) : { on: {}, jobs: { deploy: { steps: [], env: {} } } }
const job = workflow.jobs.deploy
const steps = job.steps
const named = (name: string) => steps.find((step: any) => step.name === name) ?? { run: 'exit 99', with: {} }
const config = {
  DEPLOY_ENVIRONMENT: 'production', AWS_REGION: 'us-east-1', AWS_STAGE: 'prod',
  AWS_ACCOUNT_ID: '123456789012', AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/deploy'
}
const shell = (script: string, env = config) => spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
  encoding: 'utf8', env: { PATH: process.env.PATH, ...env }
})

describe('manual conventional Lambda deployment', () => {
  it('is manual only, protected, serialized and job-scoped OIDC', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(workflow.on.workflow_dispatch.inputs.environment).toMatchObject({ required: true, type: 'environment' })
    expect(workflow.permissions).toEqual({})
    expect(job.permissions).toEqual({ contents: 'read', 'id-token': 'write' })
    expect(job.environment).toBe('${{ inputs.environment }}')
    expect(job.concurrency).toEqual({ group: 'admin-bff-${{ inputs.environment }}', 'cancel-in-progress': false })
    for (const key of ['AWS_REGION', 'AWS_STAGE', 'AWS_ACCOUNT_ID', 'AWS_ROLE_ARN']) {
      expect(job.env[key]).toBe('${{ vars.' + key + ' }}')
    }
  })

  it('orders configuration, checkout/submodules, tests/build, OIDC, identity and apply', () => {
    expect(steps.map((step: any) => step.name)).toEqual([
      'Validate target configuration', 'Checkout', 'Setup Node',
      'Install dependencies', 'Test', 'Build', 'Configure AWS credentials', 'Verify AWS account', 'Apply Terragrunt'
    ])
    expect(named('Checkout').with).toEqual({ token: '${{ github.token }}', 'persist-credentials': true, submodules: 'recursive' })
    expect(named('Install dependencies').run).toBe('npm ci')
    expect(named('Test').run).toBe('npm test')
    expect(named('Build').run).toBe('npm run build')
    expect(named('Setup Node').with['node-version']).toBe('20')
    expect(named('Configure AWS credentials').uses).toBe('aws-actions/configure-aws-credentials@v5')
    expect(named('Configure AWS credentials').with).toMatchObject({
      'role-to-assume': '${{ env.AWS_ROLE_ARN }}', 'aws-region': '${{ env.AWS_REGION }}',
      'allowed-account-ids': '${{ env.AWS_ACCOUNT_ID }}'
    })
    expect(named('Apply Terragrunt').with).toEqual({
      tf_version: '1.9.8', tg_version: '0.69.1', tg_dir: 'aws',
      tg_command: 'run-all apply --terragrunt-non-interactive -auto-approve'
    })
    expect(JSON.stringify(workflow)).not.toMatch(/AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|pilot|web.functions/i)
  })

  for (const key of Object.keys(config)) {
    it(`rejects missing ${key} before any next command`, () => {
      const result = shell(named('Validate target configuration').run + '\nprintf "NEXT\\n"', { ...config, [key]: '' })
      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe(`Missing required configuration: ${key}\n`)
    })
  }

  for (const [key, value] of [
    ['AWS_ACCOUNT_ID', '123'], ['AWS_STAGE', 'localstack'], ['AWS_REGION', ''],
    ['AWS_ROLE_ARN', 'arn:aws:iam::999999999999:role/deploy']
  ]) {
    it(`rejects invalid ${key} without proceeding`, () => {
      const result = shell(named('Validate target configuration').run + '\nprintf "NEXT\\n"', { ...config, [key]: value })
      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe(key === 'AWS_REGION'
        ? 'Missing required configuration: AWS_REGION\n' : `Invalid configuration: ${key}\n`)
    })
  }

  it('accepts an explicit valid target without output', () => {
    const result = shell(named('Validate target configuration').run)
    expect([result.status, result.stdout, result.stderr]).toEqual([0, '', ''])
  })

  for (const [account, exit] of [['999999999999', 0], ['', 1]]) {
    it(`stops before apply on identity mismatch or STS failure (${account})`, () => {
      const result = shell(`aws() { printf '%s' '${account}'; return ${exit}; }\n` +
        named('Verify AWS account').run + '\nprintf "APPLY\\n"')
      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe(exit === 0 ? 'AWS account mismatch; refusing deployment\n' : '')
    })
  }

  it('queries STS and permits the matching account', () => {
    const result = shell('aws() { [[ "$*" == "sts get-caller-identity --query Account --output text" ]] || return 2; printf 123456789012; }\n' +
      named('Verify AWS account').run)
    expect([result.status, result.stdout, result.stderr]).toEqual([0, '', ''])
  })
})
