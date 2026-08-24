import { Module } from '@nestjs/common'
import { AesService, ENCRYPTION_KEY_NAME_PROPERTY } from '@titvo/shared'

/**
 * Ported from the identical `CryptoModule` pattern used by
 * titvo-task-status-aws/titvo-task-trigger-aws/titvo-task-cli-files-aws/
 * titvo-auth-setup-aws — provides the SAME `AesService` (no
 * reimplementation, task 3.3) wired to this Lambda's `ENCRYPTION_KEY_NAME`
 * env var (task 3.14's remaining AES-secret IAM/env wiring).
 */
@Module({
  providers: [
    AesService,
    {
      provide: ENCRYPTION_KEY_NAME_PROPERTY,
      useValue: process.env.ENCRYPTION_KEY_NAME as string
    }
  ],
  exports: [AesService, ENCRYPTION_KEY_NAME_PROPERTY]
})
export class CryptoModule {}
