# Manually deploy the conventional BFF

Use **Actions → Deploy conventional BFF to AWS → Run workflow** only after the
prerequisites below are reviewed. This deploys the existing `aws/` Terragrunt
stack, not the Web Functions pilot. Adding this workflow does not deploy anything.

## Configure once, before dispatch

Create a GitHub Environment for each approved target. Enable required reviewers
and restrict deployment branches/tags to reviewed refs (normally `main`). Keep one
environment per AWS target; concurrency is serialized by environment, not account.
Environment protection is an operator prerequisite, not automatically provisioned
by this workflow. Never approve an unreviewed workflow ref: it receives OIDC rights.

Set these environment variables in GitHub Settings → Environments:

| Variable | Required value |
| --- | --- |
| `AWS_REGION` | Explicit AWS region used by the existing infrastructure |
| `AWS_STAGE` | `prod` or `test`; no implicit production or localstack fallback |
| `AWS_ACCOUNT_ID` | Expected 12-digit account, including any leading zeroes |
| `AWS_ROLE_ARN` | Deployment role ARN in that same account |

The dispatch input selects the environment; it does not guess an AWS target.
Missing configuration or malformed account/region/stage/role fails before OIDC.
The credentials action restricts allowed accounts and a separate STS identity
check must match `AWS_ACCOUNT_ID` before any Terragrunt operation.

### OIDC and repository access

Provision GitHub's OIDC provider and a dedicated deployment role outside this
change. Trust `token.actions.githubusercontent.com` with audience `sts.amazonaws.com`
and an exact subject `repo:KaribuLab/titvo-admin-bff-aws:environment:<environment>`
(replace the placeholder with the approved environment name). Avoid wildcard repo
or environment trust. Branch restrictions belong on the GitHub Environment when
using this environment-form OIDC subject.

Grant only the deployment permissions required by the existing modules: state
bucket/lock-table access, deployment artifact storage, relevant SSM reads and
Lambda, API Gateway, CloudWatch and execution-role management, including narrowly
scoped PassRole. Review actual resource ARNs with the infrastructure owner; this
workflow does not create OIDC trust or broaden any IAM policy. Static AWS access
keys are not used. `contents: read` and `id-token: write` are scoped to the job.

Checkout uses `github.token`, recursive submodules, and no SSH key. Checkout v4
converts `git@github.com:` URLs (including nested `lib/aws/shared`) to HTTPS and
configures token authentication. Public dependencies need no new PAT. The normal
repository token cannot read private sibling repositories: if a dependency becomes
private, stop and arrange narrowly scoped access separately, not a broad PAT.

## Existing infrastructure prerequisites

- Shared security-scan infrastructure and its SSM parameters must already exist
  under `/tvo/security-scan/<stage>/infra`: DynamoDB tables, JWT/AES secrets and
  KMS key name, the task-trigger API endpoint used by `aws/lambda`, and the
  existing `account` API Gateway ID used by `aws/apigateway`.
  `aws/parameter` reads these values; mock dependency outputs are not live resources.
- Preserve the existing `serverless.hcl` and root `terragrunt.hcl` conventions.
  With the mandatory account ID, the bucket is
  `tvo-admin-bff-<region>-<account-id>` and the lock table is that name plus
  `-tfstate-lock`. State keys remain `aws/<module>/terraform.tfstate`.
  Confirm these are the intended existing state addresses before approving.
  A previous deployment without `AWS_ACCOUNT_ID` used an unsuffixed bucket;
  **do not dispatch against that estate until its state ownership/migration is
  resolved separately**. Stage is not part of the bucket or state key: do not
  treat `prod` and `test` in the same region/account as isolated deployments.
  No state migration or naming change is included here.
- Confirm state bucket/lock-table and artifact storage access, module-source
  accessibility, account quotas, and a reviewed infrastructure plan with the
  infrastructure owner. Terragrunt may bootstrap missing backend resources;
  absence of existing state can create a second estate, not update the first.
- Node 20 builds the conventional Lambda, matching existing `nodejs20.x` runtime.
  Terraform `1.9.8` and Terragrunt `0.69.1` follow the sibling workflow convention
  and the current legacy `run-all` HCL/CLI syntax. Existing AWS provider `6.46.0`
  and module references remain untouched.

## Run and verify

1. Review the selected ref and the environment's account, region, stage, role,
   state addresses and approvals. The workflow must be on the default branch for
   GitHub to expose manual dispatch; select only an approved deployment ref.
2. Run the workflow and select the preconfigured environment. Approve its
   protected-environment deployment only after the target review.
3. The workflow checks configuration, checks out recursive dependencies, runs
   `npm ci`, `npm test`, then `npm run build` before requesting AWS credentials.
   Any failure stops later steps. No local deployment is part of this change.
4. After identity verification, the Terragrunt action runs from `aws/` with
   `run-all apply --terragrunt-non-interactive -auto-approve`. This is an actual
   auto-approved apply, not a plan-only workflow or a saved-plan approval gate.
   Environment approval happens before the job, not after a plan preview.
5. The existing Lambda module packages repository `build/` (including
   `build/src/entrypoint.mjs`) into `dist/<function-name>.zip`, uploads it, and
   applies dependencies in Terragrunt order. Do not zip `pilot-build/`, apply at
   the repository root, or upload a different artifact. Handler remains
   `src/entrypoint.handler`; infrastructure owns packaging and API provisioning.
6. Inspect the action logs and deployed endpoint with the infrastructure owner;
   confirm health and authentication/session behavior before enabling consumers.
   This offline implementation has not performed those live checks.

## Rollback and known limitations

To roll back application code, manually dispatch a previously reviewed good ref
that contains this workflow, with the **same** environment configuration. If the
old ref predates the workflow, prepare a reviewed revert on a workflow-bearing
branch. Review infrastructure differences first; reapplying old code is not a
state rollback and cannot undo destructive infrastructure or data changes. A
partially failed apply can leave changed resources; reconcile the state/plan
before retrying. Do not cancel an active apply or restore state blindly.

**Separate live-readiness issue:** the existing Lambda session-table policy grants
`GetItem`/`UpdateItem` but lacks `PutItem`/`DeleteItem`. Login/logout can fail even
when deployment succeeds. This workflow intentionally does not fix application
or IAM behavior; resolve and validate that independently before production use.
Node 20 runtime lifecycle/support must also be checked by the operator; no runtime
upgrade is included.

Actions currently use upstream major-version tags (`checkout@v4`, `setup-node@v4`,
`configure-aws-credentials@v5`, `terragrunt-action@v2`), not guessed commit SHAs.
These refs are mutable; verified immutable pins are a follow-up hardening task.
No AWS readiness is claimed: OIDC trust, IAM, state, provider/module compatibility
and the deployed endpoint still need a controlled live validation.

## Offline verification

From this repository, with existing dependencies available:

```sh
npm test -- test/deployment/workflow.spec.ts
npm test
npm run build
git diff --check
```

Focused tests parse the workflow using the existing installed YAML parser and run
its inline Bash gates with mocked STS. They check rejection output/status and that
no next/apply marker executes. Structural tests cover manual triggers, permissions,
checkout, deployment ordering and the pinned Terraform/Terragrunt inputs. They do
not emulate GitHub protection, fetch actions, run Terraform, or access AWS.
