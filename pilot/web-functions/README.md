# Isolated Web Functions pilot: local preparation

**Locally validated with Terraform; NOT deployed or verified in AWS.** This standalone root prepares
an IAM-protected Web Function behind its own API-only CloudFront distribution,
with dedicated storage, empty secrets and restricted execution IAM. It is outside
`aws/` and must never be included by the existing installer. Production deployment,
traffic, provider pins and IAM remain unchanged. This implements the infrastructure
source portion of T1/S1; it does not demonstrate functional deployment or auth.

## Review first

| Surface | Isolation decision |
| --- | --- |
| Providers | Released `aws = 6.69.0`, `awscc = 1.106.0`; Terraform >=1.9 |
| Account | Explicit account ID and validated same-account deployment role ARN; both providers assume that role; AWS also uses `allowed_account_ids` |
| Region | Explicit announced Web Functions region; no default |
| State | Default local state; no backend or production state references |
| Data | Three dedicated on-demand tables; no production table/secret/SSM inputs |
| Secrets | Empty JWT/AES containers; no generated values or secret versions |
| Runtime IAM | Pilot reads, session lifecycle writes, exact secret reads, scoped log streams |
| Artifacts | Private, versioned, encrypted bucket; no force destruction |
| Endpoint | `HomeRegion` + `IamAuth`, revision weight 100; no public fallback |
| CloudFront | Lambda OAC, `always-amz-auth`/`sigv4`, HTTPS origin, no API caching |

No AWS account calls, deployment, AWS secret initialization or data seeding,
performance measurements, or cost comparisons were performed. A separate
loopback-only LocalStack smoke seeded disposable local data and passed 15 API
checks using the actual bundle; see the runtime guide for the observed scope. Terraform 1.9.8
was installed locally after the installer-managed executable was checked and
found absent. Provider initialization downloaded the pinned, HashiCorp-signed
providers; it did not access an AWS account. Local schema/mock checks are not
AWS runtime verification.

## Bootstrap account safety

Supply a **pre-existing, explicitly approved** `pilot_deployment_role_arn` in
`account_id`. Both providers assume that exact role; the caller must have
`sts:AssumeRole` permission and the role must trust the approved caller. This root
does not create its own provisioning role. The ARN/account validation uses
Terraform >=1.9 cross-variable validation. awscc has no `allowed_account_ids`
field; its `assume_role` is an attribute object, not a nested block. No live
identity check was run. Do not put credentials or secrets in tfvars.

The approved account, role, region, state directory and completed plan must be
reviewed before any future provisioning. These guards cannot make a wrongly
approved account safe. Never copy production state or use production inputs.

## Prepare the artifact locally

See [the runtime guide](../../docs/web-functions-pilot.md) for the transport
contract and tests. From the repository root, its build command is:

```sh
npx --no-install rspack build -c rspack.web-functions.cjs
```

Manually create the archive **from inside `pilot-build/`**, for example:

```sh
cd pilot-build
zip web-functions-pilot.zip index.mjs
```

Inspect the archive: `index.mjs` must be at the ZIP root, not inside `pilot-build/`.
Include any additional runtime files required by the build. ZIP layout is an
operator check, not validated by the Terraform path check. Pass its absolute path
as `artifact_zip_path`; do not commit the ZIP. HCL contains no provisioners,
`local-exec`, builds or ZIP commands. The revision references the uploaded object's
version ID. Bucket policy grants Lambda only GetObject/GetObjectVersion on that
object, conditioned on the expected source account and exact function ARN.

## Local validation results

Observed with Terraform **1.9.8**, `aws 6.69.0` and `awscc 1.106.0`:

| Check | Result |
| --- | --- |
| `fmt -check -diff -recursive` | Passed after alignment-only formatting corrections |
| `init -backend=false -input=false` | Passed; both downloaded providers signed by HashiCorp |
| `validate` | Passed; DynamoDB `hash_key` deprecation warnings remain |
| `test` with both providers mocked | **4 passed, 0 failed**, including rejected role/region cases |

The initial mock run was RED (one pass, one failure, two skips): an omitted
CloudFront aliases set is `null`, not necessarily an empty set. The no-domain
assertion now handles both representations; the next complete run was GREEN.
No deployed resource was changed by this correction.

To reproduce, set `TF_BIN` to an approved Terraform >=1.9 executable and run
from this directory. This session's ignored project-local executable is
`../../pilot-build/tools/terraform-1.9.8/terraform`; the installer-managed
alternative, when installed, is `~/.titvo/bin/terraform`. Neither needs to be on
PATH. Provider initialization requires downloads; this is not an offline install.

```sh
"$TF_BIN" fmt -check -recursive
"$TF_BIN" init -backend=false -input=false
"$TF_BIN" validate
"$TF_BIN" test -var='artifact_zip_path=/absolute/path/web-functions-pilot.zip'
```

Use isolated HOME/TMPDIR/provider data under the project, no AWS credentials or
profiles, empty AWS config/shared-credentials files, and disabled EC2 metadata
discovery. On macOS, keep TMPDIR short: long paths can exceed the Unix socket
limit and prevent provider startup. This session used the ignored
`pilot-build/terraform-local.sh` environment wrapper; it is a local tool, not a
checked-in deployment script. No actual `terraform plan` or `terraform apply`
against an AWS account was executed.

Mock tests supply fake account/role/region inputs, mock **both** providers and
cover foundation isolation, endpoint/OAC/policy wiring, versioned artifacts,
selected IAM/runtime invariants and rejected account/region inputs. The test's
`command = apply` is a provider-mocked test operation, not an AWS deployment.
A real local ZIP is still needed for file hashing. The observed local test and
schema results above do not prove AWS startup, ARM64 runtime behavior,
CloudFront signing, raw-origin denial, or browser authentication.

For a future real plan, explicitly supply `account_id`, `region`,
`pilot_deployment_role_arn`, and `artifact_zip_path`. No plan/apply is authorized
by this preparation. Review the account, state, artifact, lock file and plan
before any activation. Initialization generated a real provider lock file under
the pilot root; existing repository ignore rules currently exclude it. Review
and include the lock file only with separately authorized delivery. State/tfvars
are ignored but remain sensitive operator files.

## Source wiring and security contract

The parent supplied tagged awscc 1.106.0 argument schemas for the Web Function,
revision, endpoint, resource policy and provider. Nested awscc attributes use
objects (`=`), not blocks. AWS 6.69.0 supports the required OAC signing validator
according to parent prerequisite evidence; production AWS 6.46.0 is unchanged.
Terraform validation and mocked wiring checks now pass with those pinned
providers. This does not establish live service behavior or replace AWS smoke
checks.

Creation dependencies are acyclic: function and artifact → bucket policy →
revision → endpoint → distribution → invoke policy. The function does not depend
on the bucket or distribution-bound invoke policy. The revision waits for bucket
read permissions and execution IAM; the URL output waits for the invoke policy.
The endpoint may exist before the distribution policy, but remains IAM-only.

The function uses `nodejs24.x`, `index.mjs`, `AWS_STAGE=web-functions-pilot`,
`LOG_LEVEL=info`, dedicated table/secret names, one concurrent request per
environment, at most two environments, and endpoint throttle 100. Telemetry uses
the precreated log group with application/system INFO levels. The execution role
cannot create arbitrary log groups. Secret **values are not configured**.

The required remaining table variables point to pilot-only nonexistent
`titvo-web-functions-pilot-unavailable-{repository,task,apikey}` names and receive
no IAM permissions. `TASK_TRIGGER_API_URL=https://web-functions-pilot.invalid`
is inert. There are no scan triggers, user/config business writes, wildcard
storage grants, or production IAM fixes. Do not create those unavailable tables
or configure LocalStack endpoints/credentials.

CloudFront uses its own default domain, no frontend site, custom domain, ACM
certificate, `/v1` origin path, or SPA 403/404 rewriting. Viewers redirect to HTTPS;
the origin is HTTPS-only. AllViewerExceptHostHeader forwards cookies, query
strings and relevant headers; a custom zero-TTL cache policy explicitly forwards
viewer Authorization. All seven read/write methods reach the adapter so its
allowlist rejections remain observable. The runtime permits only
health/login/me/logout/config-list. Initial testing is curl against this API
domain; do not imply an existing frontend has been deployed there.

The invoke policy attaches to the **function ARN** and grants
`lambda:InvokeWebFunctionEndpoint` on the **endpoint ARN** only to
`cloudfront.amazonaws.com`, conditioned on this distribution's exact SourceArn.
There is no public `ApplicationManaged` fallback. Outputs contain only the pilot
URL and resource names, never secret values.

## Operator permissions and activation blockers

The approved provisioner needs scoped DynamoDB lifecycle, Secrets Manager
container lifecycle, S3 bucket/object/version configuration, IAM role/policy
lifecycle, log group lifecycle, CloudFront OAC/distribution lifecycle and Lambda
Web Function/revision/endpoint/resource-policy lifecycle permissions. It needs
`iam:PassRole` restricted to the pilot execution role and Lambda service.

awscc also needs Cloud Control CreateResource, GetResourceRequestStatus,
GetResource, UpdateResource, DeleteResource and relevant ListResources, plus
underlying handler Get*/read and write permissions for each selected type.
Verify released handler permission lists before granting: this is not a complete
provisioner IAM policy. Cloud Control is not deployment of CloudFormation stacks.
Control-plane permissions do not belong on the runtime role; runtime Get* and
session lifecycle permissions remain narrowly defined in `iam.tf`.

**Auth end-to-end remains blocked** until separately approved procedures initialize
JWT/AES secrets in application-compatible formats and seed a fake admin in the
pilot user table. No operational seed script is provided. The existing
`local-seed.mjs` is **LocalStack-only**: never run it against AWS. Never store
passwords, AES/JWT material or secret versions in Terraform/state. Subsequent AWS
smoke checks must verify raw-origin denial, CloudFront cookie login/me/logout,
config-list reads and disabled-route rejection. None were performed here.

## Rollback and teardown

Production traffic never moves: leave its route unchanged and stop using the
pilot domain. Do not modify production DNS or the installer. Future teardown
requires explicit data-retention review: DynamoDB deletion loses pilot data;
versioned S3 objects prevent ordinary bucket deletion until deliberately handled;
secrets retain a 30-day recovery window. There is no force-delete shortcut or
automatic teardown command.

## References

- [Runtime build, routes and transport tests](../../docs/web-functions-pilot.md)
- [AWS endpoint access control](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoint-access-control.html)
- [Pinned awscc provider arguments](https://github.com/hashicorp/terraform-provider-awscc/blob/v1.106.0/docs/index.md)
- [Pinned Web Function](https://github.com/hashicorp/terraform-provider-awscc/blob/v1.106.0/docs/resources/lambda_web_function.md)
- [Pinned revision](https://github.com/hashicorp/terraform-provider-awscc/blob/v1.106.0/docs/resources/lambda_web_function_revision.md)
- [Pinned endpoint](https://github.com/hashicorp/terraform-provider-awscc/blob/v1.106.0/docs/resources/lambda_web_function_endpoint.md)
- [Pinned resource policy](https://github.com/hashicorp/terraform-provider-awscc/blob/v1.106.0/docs/resources/lambda_resource_policy.md)
- [AWS resource policy Web Function support](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-resourcepolicy.md)
- [S1 and task boundaries](../../odd/tasks/web-functions-pilot.md)
