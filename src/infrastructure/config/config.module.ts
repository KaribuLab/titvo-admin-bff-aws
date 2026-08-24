import { Module } from '@nestjs/common'
import { createConfigRepository } from '@infrastructure/config/config.dynamo'
import { ConfigRepository } from '@core/config/config.repository'
import { CryptoModule } from '@infrastructure/crypto/crypto.module'
import { ListConfigUseCase } from '@app/config/list-config.use-case'
import { GetConfigUseCase } from '@app/config/get-config.use-case'
import { AddConfigUseCase } from '@app/config/add-config.use-case'
import { UpdateConfigUseCase } from '@app/config/update-config.use-case'

@Module({
  imports: [CryptoModule],
  providers: [
    {
      provide: ConfigRepository,
      useFactory: () => {
        return createConfigRepository({
          tableName: process.env.PARAMETER_TABLE_NAME as string,
          awsStage: process.env.AWS_STAGE as string,
          awsEndpoint: process.env.AWS_ENDPOINT as string
        })
      }
    },
    ListConfigUseCase,
    GetConfigUseCase,
    AddConfigUseCase,
    UpdateConfigUseCase
  ],
  exports: [ListConfigUseCase, GetConfigUseCase, AddConfigUseCase, UpdateConfigUseCase]
})
export class ConfigModule {}
