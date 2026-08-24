import { Module } from '@nestjs/common'
import { createScanRepository } from '@infrastructure/scan/scan.dynamo'
import { ScanRepository } from '@core/scan/scan.repository'
import { ListScansForRepoUseCase } from '@app/scan/list-scans-for-repo.use-case'
import { GetScanUseCase } from '@app/scan/get-scan.use-case'

@Module({
  providers: [
    {
      provide: ScanRepository,
      useFactory: () => {
        return createScanRepository({
          taskTableName: process.env.TASK_TABLE_NAME as string,
          awsStage: process.env.AWS_STAGE as string,
          awsEndpoint: process.env.AWS_ENDPOINT as string
        })
      }
    },
    ListScansForRepoUseCase,
    GetScanUseCase
  ],
  exports: [ScanRepository, ListScansForRepoUseCase, GetScanUseCase]
})
export class ScanModule {}
