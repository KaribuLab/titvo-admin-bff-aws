/**
 * Thrown when `PATCH /api/admin/users/:id` targets a `userId` that does
 * not exist — either the pre-fetch (`UserRepository.findById`) misses, or
 * `DynamoUserRepository.update`'s `ConditionExpression:
 * attribute_exists(#user_id)` rejects the write (no phantom item
 * creation), mirroring `DynamoApiKeyRepository.revoke`'s equivalent guard
 * (Work Unit 5).
 */
export class UserNotFoundError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'UserNotFoundError'
  }
}
