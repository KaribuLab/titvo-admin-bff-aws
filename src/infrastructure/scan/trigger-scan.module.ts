import { Module } from '@nestjs/common'
import { AesService } from '@titvo/shared'
import { ApiKeyRepository, ValidateApiKeyUseCase } from '@titvo/auth'
import { CryptoModule } from '@infrastructure/crypto/crypto.module'
import { createRepoRepository } from '@infrastructure/repo/repo.dynamo'
import { RepoRepository } from '@core/repo/repo.repository'
import { createConfigRepository } from '@infrastructure/config/config.dynamo'
import { ConfigRepository } from '@core/config/config.repository'
import { createApiKeyRepository } from '@infrastructure/api-key/api-key.dynamo'
import { GithubApiClient } from '@core/scan/github-api.client'
import { BitbucketApiClient } from '@core/scan/bitbucket-api.client'
import { TaskTriggerClient } from '@core/scan/task-trigger.client'
import { AxiosGithubApiClient } from '@infrastructure/scan/github-api.axios-client'
import { AxiosBitbucketApiClient } from '@infrastructure/scan/bitbucket-api.axios-client'
import { AxiosTaskTriggerClient } from '@infrastructure/scan/task-trigger.axios-client'
import { GithubScanTriggerStrategy } from '@app/scan/github-scan-trigger.strategy'
import { BitbucketScanTriggerStrategy } from '@app/scan/bitbucket-scan-trigger.strategy'
import { TriggerScanUseCase } from '@app/scan/trigger-scan.use-case'
import { GetDefaultBranchUseCase } from '@app/scan/get-default-branch.use-case'

/**
 * Dedicated module for `TriggerScanUseCase` and its per-provider strategies
 * (task 3.x: trigger-a-scan feature, extended for Bitbucket parity), kept
 * separate from `RepoModule`/`ConfigModule` rather than exporting new
 * providers from either — those modules' existing exports
 * (`ListReposUseCase`/config use-cases only) are left untouched, per the
 * "do not touch existing endpoints' behavior" constraint. `RepoRepository`
 * and `ConfigRepository` are re-created here via the SAME factory
 * functions those modules already use (same table names, same
 * localstack/AWS branching) — a small duplication that trades a few extra
 * bytes for zero risk of perturbing either module's existing DI graph.
 */
@Module({
  imports: [CryptoModule],
  providers: [
    {
      provide: RepoRepository,
      useFactory: () => createRepoRepository({
        tableName: process.env.REPOSITORY_TABLE_NAME as string,
        awsStage: process.env.AWS_STAGE as string,
        awsEndpoint: process.env.AWS_ENDPOINT as string
      })
    },
    {
      provide: ConfigRepository,
      useFactory: () => createConfigRepository({
        tableName: process.env.PARAMETER_TABLE_NAME as string,
        awsStage: process.env.AWS_STAGE as string,
        awsEndpoint: process.env.AWS_ENDPOINT as string
      })
    },
    {
      provide: GithubApiClient,
      useClass: AxiosGithubApiClient
    },
    {
      provide: BitbucketApiClient,
      useClass: AxiosBitbucketApiClient
    },
    {
      provide: TaskTriggerClient,
      useFactory: () => new AxiosTaskTriggerClient(process.env.TASK_TRIGGER_API_URL as string)
    },
    {
      // Re-created here via the SAME factory `ApiKeyModule` already uses
      // (same table name, same localstack/AWS branching) — needed so
      // `TriggerScanUseCase` can resolve the shared service key's owning
      // user for the repositoryId-mismatch check (see
      // `compute-expected-repository-id.ts`). No new DynamoDB table
      // permission is required (`APIKEY_TABLE_NAME`/its IAM grant already
      // exist for the api-key management endpoints) — only the
      // `api_key_gsi` index ARN needed adding to that existing IAM
      // statement (see `aws/lambda/terragrunt.hcl`).
      provide: ApiKeyRepository,
      useFactory: () => createApiKeyRepository({
        tableName: process.env.APIKEY_TABLE_NAME as string,
        awsStage: process.env.AWS_STAGE as string,
        awsEndpoint: process.env.AWS_ENDPOINT as string
      })
    },
    {
      provide: ValidateApiKeyUseCase,
      useFactory: (apiKeyRepository: ApiKeyRepository, aesService: AesService) => new ValidateApiKeyUseCase(apiKeyRepository, aesService),
      inject: [ApiKeyRepository, AesService]
    },
    {
      provide: GithubScanTriggerStrategy,
      useFactory: (
        configRepository: ConfigRepository,
        aesService: AesService,
        githubApiClient: GithubApiClient
      ) => new GithubScanTriggerStrategy(configRepository, aesService, githubApiClient),
      inject: [ConfigRepository, AesService, GithubApiClient]
    },
    {
      provide: BitbucketScanTriggerStrategy,
      useFactory: (
        configRepository: ConfigRepository,
        aesService: AesService,
        bitbucketApiClient: BitbucketApiClient
      ) => new BitbucketScanTriggerStrategy(configRepository, aesService, bitbucketApiClient),
      inject: [ConfigRepository, AesService, BitbucketApiClient]
    },
    {
      provide: TriggerScanUseCase,
      useFactory: (
        repoRepository: RepoRepository,
        configRepository: ConfigRepository,
        aesService: AesService,
        taskTriggerClient: TaskTriggerClient,
        validateApiKeyUseCase: ValidateApiKeyUseCase,
        githubStrategy: GithubScanTriggerStrategy,
        bitbucketStrategy: BitbucketScanTriggerStrategy
      ) => new TriggerScanUseCase(repoRepository, configRepository, aesService, taskTriggerClient, validateApiKeyUseCase, githubStrategy, bitbucketStrategy),
      inject: [RepoRepository, ConfigRepository, AesService, TaskTriggerClient, ValidateApiKeyUseCase, GithubScanTriggerStrategy, BitbucketScanTriggerStrategy]
    },
    {
      provide: GetDefaultBranchUseCase,
      useFactory: (
        repoRepository: RepoRepository,
        configRepository: ConfigRepository,
        aesService: AesService,
        githubApiClient: GithubApiClient,
        bitbucketApiClient: BitbucketApiClient
      ) => new GetDefaultBranchUseCase(repoRepository, configRepository, aesService, githubApiClient, bitbucketApiClient),
      inject: [RepoRepository, ConfigRepository, AesService, GithubApiClient, BitbucketApiClient]
    }
  ],
  exports: [TriggerScanUseCase, GetDefaultBranchUseCase]
})
export class TriggerScanModule {}
