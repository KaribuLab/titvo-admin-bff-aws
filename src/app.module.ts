import { Module } from '@nestjs/common'
import { SecretModule } from '@aws/secret'
import { pino } from 'pino'
import { LoggerModule } from 'nestjs-pino'
import { AuthModule } from '@infrastructure/auth/auth.module'
import { ConfigModule } from '@infrastructure/config/config.module'
import { RepoModule } from '@infrastructure/repo/repo.module'
import { ScanModule } from '@infrastructure/scan/scan.module'
import { ApiKeyModule } from '@infrastructure/api-key/api-key.module'
import { UserModule } from '@infrastructure/user/user.module'
import { TriggerScanModule } from '@infrastructure/scan/trigger-scan.module'

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
          level (label: string): { level: string } {
            return { level: label }
          }
        }
      }
    }),
    SecretModule.forRoot({
      awsStage: process.env.AWS_STAGE ?? 'prod',
      awsEndpoint: process.env.AWS_ENDPOINT ?? 'http://localhost:4566'
    }),
    AuthModule,
    ConfigModule,
    ScanModule,
    RepoModule,
    ApiKeyModule,
    UserModule,
    TriggerScanModule
  ]
})
export class AppModule {}
