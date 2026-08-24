import { Module } from '@nestjs/common'
import { createApiKeyRepository } from '@infrastructure/api-key/api-key.dynamo'
import { ApiKeyRepository } from '@titvo/auth'
import { ListApiKeysUseCase } from '@app/api-key/list-api-keys.use-case'
import { CreateApiKeyUseCase } from '@app/api-key/create-api-key.use-case'
import { RevokeApiKeyUseCase } from '@app/api-key/revoke-api-key.use-case'

@Module({
  providers: [
    {
      provide: ApiKeyRepository,
      useFactory: () => {
        return createApiKeyRepository({
          tableName: process.env.APIKEY_TABLE_NAME as string,
          awsStage: process.env.AWS_STAGE as string,
          awsEndpoint: process.env.AWS_ENDPOINT as string
        })
      }
    },
    ListApiKeysUseCase,
    CreateApiKeyUseCase,
    RevokeApiKeyUseCase
  ],
  exports: [ListApiKeysUseCase, CreateApiKeyUseCase, RevokeApiKeyUseCase]
})
export class ApiKeyModule {}
