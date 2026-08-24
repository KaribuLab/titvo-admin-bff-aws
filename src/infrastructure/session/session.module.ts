import { Module } from '@nestjs/common'
import { createSessionRepository } from '@infrastructure/session/session.dynamo'
import { SessionRepository } from '@titvo/auth'

@Module({
  providers: [
    {
      provide: SessionRepository,
      useFactory: () => {
        return createSessionRepository({
          tableName: process.env.SESSION_TABLE_NAME as string,
          awsStage: process.env.AWS_STAGE as string,
          awsEndpoint: process.env.AWS_ENDPOINT as string
        })
      }
    }
  ],
  exports: [SessionRepository]
})
export class SessionModule {}
