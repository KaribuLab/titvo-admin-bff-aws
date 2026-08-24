import { describe, expect, it, vi } from 'vitest'
import { UserRepository, UserEntity, DeactivateUserUseCase, LastAdminError } from '@titvo/auth'
import { UpdateUserUseCase } from '@app/user/update-user.use-case'
import { UserNotFoundError } from '@app/user/user.error'

function user (overrides: Partial<UserEntity>): UserEntity {
  return {
    userId: 'u1',
    email: 'user@titvo.dev',
    passwordHash: 'hash',
    role: 'member',
    status: 'active',
    createdAt: 'a',
    updatedAt: 'a',
    ...overrides
  }
}

function buildRepository (): UserRepository {
  return {
    findByEmail: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn()
  } as unknown as UserRepository
}

function buildDeactivateUserUseCase (): DeactivateUserUseCase {
  return { execute: vi.fn() } as unknown as DeactivateUserUseCase
}

describe('UpdateUserUseCase', () => {
  it('delegates a pure deactivation (status: inactive, no role change) to titvo-auth\'s DeactivateUserUseCase — does not reimplement the invariant', async () => {
    const repository = buildRepository()
    const deactivateUseCase = buildDeactivateUserUseCase()
    vi.spyOn(repository, 'findById').mockResolvedValue(user({ role: 'member', status: 'active' }))
    vi.spyOn(deactivateUseCase, 'execute').mockResolvedValue(user({ status: 'inactive' }))
    const useCase = new UpdateUserUseCase(repository, deactivateUseCase)

    const result = await useCase.execute('u1', { status: 'inactive' })

    expect(deactivateUseCase.execute).toHaveBeenCalledWith('u1')
    expect(deactivateUseCase.execute).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('inactive')
    expect(repository.findAll).not.toHaveBeenCalled()
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('de-admins a user when another active admin remains', async () => {
    const repository = buildRepository()
    const deactivateUseCase = buildDeactivateUserUseCase()
    const target = user({ userId: 'u1', role: 'admin', status: 'active' })
    const otherAdmin = user({ userId: 'u2', role: 'admin', status: 'active' })
    vi.spyOn(repository, 'findById').mockResolvedValue(target)
    vi.spyOn(repository, 'findAll')
      .mockResolvedValueOnce([target, otherAdmin])
      .mockResolvedValueOnce([{ ...target, role: 'member' }, otherAdmin])
    vi.spyOn(repository, 'update').mockResolvedValue({ ...target, role: 'member' })
    const useCase = new UpdateUserUseCase(repository, deactivateUseCase)

    const result = await useCase.execute('u1', { role: 'member' })

    expect(repository.update).toHaveBeenCalledWith('u1', { role: 'member' })
    expect(result.role).toBe('member')
  })

  it('rejects de-admin of the sole active admin with LastAdminError, without writing', async () => {
    const repository = buildRepository()
    const deactivateUseCase = buildDeactivateUserUseCase()
    const target = user({ userId: 'u1', role: 'admin', status: 'active' })
    vi.spyOn(repository, 'findById').mockResolvedValue(target)
    vi.spyOn(repository, 'findAll').mockResolvedValue([target])
    const useCase = new UpdateUserUseCase(repository, deactivateUseCase)

    await expect(useCase.execute('u1', { role: 'member' })).rejects.toThrow(LastAdminError)
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('rolls back a role-change write when a concurrent race leaves zero active admins post-write', async () => {
    const repository = buildRepository()
    const deactivateUseCase = buildDeactivateUserUseCase()
    const target = user({ userId: 'u1', role: 'admin', status: 'active' })
    const otherAdmin = user({ userId: 'u2', role: 'admin', status: 'active' })
    vi.spyOn(repository, 'findById').mockResolvedValue(target)
    vi.spyOn(repository, 'findAll')
      .mockResolvedValueOnce([target, otherAdmin]) // pre-check: 2 active admins, passes
      .mockResolvedValueOnce([{ ...target, role: 'member' }, { ...otherAdmin, status: 'inactive' }]) // post-write: raced, 0 active admins
    vi.spyOn(repository, 'update').mockResolvedValue({ ...target, role: 'member' })
    const useCase = new UpdateUserUseCase(repository, deactivateUseCase)

    await expect(useCase.execute('u1', { role: 'member' })).rejects.toThrow(LastAdminError)

    expect(repository.update).toHaveBeenCalledWith('u1', { role: 'member' })
    expect(repository.update).toHaveBeenCalledWith('u1', { role: 'admin', status: 'active' })
    expect(repository.update).toHaveBeenCalledTimes(2)
  })

  it('promotes a member to admin without checking the last-admin invariant', async () => {
    const repository = buildRepository()
    const deactivateUseCase = buildDeactivateUserUseCase()
    const target = user({ userId: 'u1', role: 'member', status: 'active' })
    vi.spyOn(repository, 'findById').mockResolvedValue(target)
    vi.spyOn(repository, 'update').mockResolvedValue({ ...target, role: 'admin' })
    const useCase = new UpdateUserUseCase(repository, deactivateUseCase)

    const result = await useCase.execute('u1', { role: 'admin' })

    expect(repository.findAll).not.toHaveBeenCalled()
    expect(repository.update).toHaveBeenCalledWith('u1', { role: 'admin' })
    expect(result.role).toBe('admin')
  })

  it('reactivates an inactive user without checking the invariant', async () => {
    const repository = buildRepository()
    const deactivateUseCase = buildDeactivateUserUseCase()
    const target = user({ userId: 'u1', role: 'member', status: 'inactive' })
    vi.spyOn(repository, 'findById').mockResolvedValue(target)
    vi.spyOn(repository, 'update').mockResolvedValue({ ...target, status: 'active' })
    const useCase = new UpdateUserUseCase(repository, deactivateUseCase)

    const result = await useCase.execute('u1', { status: 'active' })

    expect(repository.findAll).not.toHaveBeenCalled()
    expect(result.status).toBe('active')
  })

  it('throws UserNotFoundError when the target does not exist, without any write', async () => {
    const repository = buildRepository()
    const deactivateUseCase = buildDeactivateUserUseCase()
    vi.spyOn(repository, 'findById').mockResolvedValue(null)
    const useCase = new UpdateUserUseCase(repository, deactivateUseCase)

    await expect(useCase.execute('missing', { role: 'member' })).rejects.toThrow(UserNotFoundError)
    expect(repository.findAll).not.toHaveBeenCalled()
    expect(repository.update).not.toHaveBeenCalled()
  })
})
