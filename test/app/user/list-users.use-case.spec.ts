import { describe, expect, it, vi } from 'vitest'
import { UserRepository, UserEntity } from '@titvo/auth'
import { ListUsersUseCase } from '@app/user/list-users.use-case'

function buildUserRepository (findAll: () => Promise<UserEntity[]>): UserRepository {
  return { findAll } as unknown as UserRepository
}

describe('ListUsersUseCase', () => {
  it('returns an empty array when there are no users (spec: seed-admin-only is not an error)', async () => {
    const useCase = new ListUsersUseCase(buildUserRepository(async () => []))

    expect(await useCase.execute()).toEqual([])
  })

  it('returns metadata for every user: userId, email, role, status, createdAt, updatedAt', async () => {
    const entity: UserEntity = {
      userId: 'u1',
      email: 'admin@titvo.dev',
      passwordHash: 'super-secret-bcrypt-hash',
      role: 'admin',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const useCase = new ListUsersUseCase(buildUserRepository(async () => [entity]))

    const result = await useCase.execute()

    expect(result).toEqual([{
      userId: 'u1',
      email: 'admin@titvo.dev',
      role: 'admin',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }])
  })

  it('NEVER includes passwordHash on any returned item (security: hash-free by construction)', async () => {
    const entity: UserEntity = {
      userId: 'u1',
      email: 'admin@titvo.dev',
      passwordHash: 'super-secret-bcrypt-hash-should-never-leak',
      role: 'admin',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const useCase = new ListUsersUseCase(buildUserRepository(async () => [entity]))

    const result = await useCase.execute()

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('super-secret-bcrypt-hash-should-never-leak')
    expect(result[0]).not.toHaveProperty('passwordHash')
    expect(Object.keys(result[0]).sort()).toEqual(['createdAt', 'email', 'role', 'status', 'updatedAt', 'userId'].sort())
  })

  it('missing status renders as active (D7: absence means active)', async () => {
    const entity: UserEntity = {
      userId: 'u1',
      email: 'legacy@titvo.dev',
      passwordHash: 'hash',
      role: 'member',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const useCase = new ListUsersUseCase(buildUserRepository(async () => [entity]))

    const result = await useCase.execute()

    expect(result[0].status).toBe('active')
  })
})
