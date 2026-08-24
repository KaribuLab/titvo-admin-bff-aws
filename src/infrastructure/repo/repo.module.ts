import { Module } from '@nestjs/common'
import { createRepoRepository } from '@infrastructure/repo/repo.dynamo'
import { RepoRepository } from '@core/repo/repo.repository'
import { ScanModule } from '@infrastructure/scan/scan.module'
import { ListReposUseCase } from '@app/repo/list-repos.use-case'

@Module({
  imports: [ScanModule],
  providers: [
    {
      provide: RepoRepository,
      useFactory: () => {
        return createRepoRepository({
          tableName: process.env.REPOSITORY_TABLE_NAME as string,
          awsStage: process.env.AWS_STAGE as string,
          awsEndpoint: process.env.AWS_ENDPOINT as string
        })
      }
    },
    ListReposUseCase
  ],
  exports: [ListReposUseCase]
})
export class RepoModule {}
