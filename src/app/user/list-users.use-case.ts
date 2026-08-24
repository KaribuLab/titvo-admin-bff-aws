import { Injectable } from '@nestjs/common'
import { UserRepository, UserEntity, UserRole, UserStatus } from '@titvo/auth'

/**
 * Metadata-only projection of a user — structurally has no `passwordHash`
 * field at all, defense-in-depth so the hash cannot leak even from a
 * future handler bug (mirrors `ApiKeyListItem`, Work Unit 5).
 */
export interface UserListItem {
  userId: string
  email: string
  role: UserRole
  status: UserStatus
  createdAt: string
  updatedAt: string
}

function toListItem (entity: UserEntity): UserListItem {
  return {
    userId: entity.userId,
    email: entity.email,
    role: entity.role,
    // Design D7: a missing `status` attribute means active — never
    // propagate `undefined` here, always resolve it to the real value.
    status: entity.status ?? 'active',
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt
  }
}

/** `GET /api/admin/users` — spec: readable by `admin` and `member`. */
@Injectable()
export class ListUsersUseCase {
  constructor (private readonly userRepository: UserRepository) { }

  async execute (): Promise<UserListItem[]> {
    const users = await this.userRepository.findAll()
    return users.map(toListItem)
  }
}
