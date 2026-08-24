import { Module } from '@nestjs/common'
import { createUserRepository } from '@infrastructure/user/user.dynamo'
import { UserRepository, PasswordHasherService, CreateUserUseCase, DeactivateUserUseCase } from '@titvo/auth'
import { ListUsersUseCase } from '@app/user/list-users.use-case'
import { UpdateUserUseCase } from '@app/user/update-user.use-case'

/**
 * Extended in Work Unit 6 (Phase 6, user management BFF endpoints) beyond
 * its original session-guard-only `UserRepository` scope. `CreateUserUseCase`/
 * `DeactivateUserUseCase` are titvo-auth's own use-cases, wired here
 * unmodified — this module never reimplements the last-admin invariant,
 * see `UpdateUserUseCase`.
 */
@Module({
  providers: [
    {
      provide: UserRepository,
      useFactory: () => {
        return createUserRepository({
          tableName: process.env.USER_TABLE_NAME as string,
          awsStage: process.env.AWS_STAGE as string,
          awsEndpoint: process.env.AWS_ENDPOINT as string
        })
      }
    },
    PasswordHasherService,
    CreateUserUseCase,
    DeactivateUserUseCase,
    ListUsersUseCase,
    UpdateUserUseCase
  ],
  exports: [UserRepository, CreateUserUseCase, ListUsersUseCase, UpdateUserUseCase]
})
export class UserModule {}
