import { Module } from '@nestjs/common'
import { UserModule } from '@infrastructure/user/user.module'
import { SessionModule } from '@infrastructure/session/session.module'
import {
  ValidateSessionUseCase,
  LoginUseCase,
  LogoutUseCase,
  PasswordHasherService,
  JwtService,
  JWT_SECRET_NAME_PROPERTY
} from '@titvo/auth'
import { SessionGuardService } from './session-guard.service'

/**
 * Extended from the Batch 5 scaffold+guard slice: `LoginUseCase`/
 * `LogoutUseCase`/`PasswordHasherService` are now wired because this repo
 * exposes `/api/admin/auth/{login,logout,me}` — the BFF proxies auth
 * itself instead of leaving it to titvo-auth-setup-aws's own `/auth/*`
 * surface (bff-auth-routing-decision: CloudFront only forwards `/api/*`,
 * so the browser has no path to a second gateway).
 */
@Module({
  providers: [
    ValidateSessionUseCase,
    LoginUseCase,
    LogoutUseCase,
    PasswordHasherService,
    JwtService,
    SessionGuardService,
    {
      provide: JWT_SECRET_NAME_PROPERTY,
      useValue: process.env.JWT_SECRET_NAME as string
    }
  ],
  imports: [UserModule, SessionModule],
  exports: [SessionGuardService, LoginUseCase, LogoutUseCase]
})
export class AuthModule {}
