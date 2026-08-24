import { Injectable, Logger } from '@nestjs/common'
import {
  UserRepository,
  UserEntity,
  UserRole,
  UserStatus,
  DeactivateUserUseCase,
  LastAdminError,
  countActiveAdmins,
  wouldViolateLastAdminInvariant
} from '@titvo/auth'
import { UserNotFoundError } from '@app/user/user.error'

export interface UpdateUserPatch {
  role?: UserRole
  status?: UserStatus
}

/**
 * `PATCH /api/admin/users/:id` (design API contract — a single combined
 * endpoint for role AND status changes, not separate deactivate/role
 * routes). Reuses titvo-auth's use-cases and pure guard functions
 * directly rather than reimplementing the last-admin invariant here
 * (orchestrator instruction / design risk resolution #2):
 *
 * - A pure deactivation (`{status: 'inactive'}`, role unchanged)
 *   delegates entirely to `DeactivateUserUseCase`, which already owns the
 *   guarded write + post-write rollback for that exact case.
 * - A role change (de-admin) or a combined role+status change has no
 *   matching titvo-auth use-case, so this class orchestrates the write —
 *   but the invariant itself is still evaluated with titvo-auth's own
 *   `countActiveAdmins`/`wouldViolateLastAdminInvariant` pure functions,
 *   never a BFF-local reimplementation.
 * - A patch that does not remove the target from the active-admin set
 *   (promotions, reactivations, member-only edits) skips the guard
 *   entirely — it cannot violate the invariant.
 */
@Injectable()
export class UpdateUserUseCase {
  private readonly logger = new Logger(UpdateUserUseCase.name)

  constructor (
    private readonly userRepository: UserRepository,
    private readonly deactivateUserUseCase: DeactivateUserUseCase
  ) { }

  async execute (userId: string, patch: UpdateUserPatch): Promise<UserEntity> {
    const current = await this.userRepository.findById(userId)
    if (current === null) {
      throw new UserNotFoundError(`User '${userId}' does not exist`)
    }

    if (patch.status === 'inactive' && patch.role === undefined) {
      return await this.deactivateUserUseCase.execute(userId)
    }

    const effectiveRole = patch.role ?? current.role
    const effectiveStatus = patch.status ?? current.status
    const currentlyActiveAdmin = current.role === 'admin' && current.status !== 'inactive'
    const willBeActiveAdmin = effectiveRole === 'admin' && effectiveStatus !== 'inactive'
    const removesActiveAdmin = currentlyActiveAdmin && !willBeActiveAdmin

    if (removesActiveAdmin) {
      const usersBeforeWrite = await this.userRepository.findAll()
      if (wouldViolateLastAdminInvariant(usersBeforeWrite, userId)) {
        this.logger.warn('User update rejected: would leave zero active admins')
        throw new LastAdminError('Cannot remove the last active admin')
      }
    }

    const updated = await this.userRepository.update(userId, patch)

    if (removesActiveAdmin) {
      const usersAfterWrite = await this.userRepository.findAll()
      if (countActiveAdmins(usersAfterWrite) === 0) {
        this.logger.warn('User update raced the last-admin invariant post-write — rolling back')
        await this.userRepository.update(userId, { role: current.role, status: current.status })
        throw new LastAdminError('Cannot remove the last active admin')
      }
    }

    return updated
  }
}
