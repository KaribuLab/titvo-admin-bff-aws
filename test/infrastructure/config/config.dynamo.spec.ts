import { describe, expect, it, vi } from 'vitest'
import { DynamoConfigRepository } from '@infrastructure/config/config.dynamo'
import { ConfigAlreadyExistsError } from '@app/config/config.error'

function buildClient (sendImpl: (command: any) => Promise<any>) {
  return { send: vi.fn(sendImpl) }
}

describe('DynamoConfigRepository.findAll', () => {
  it('returns an empty array when the table has no items (empty-table scenario)', async () => {
    const client = buildClient(async () => ({}))
    const repository = new DynamoConfigRepository(client as any, 'parameter-table')

    expect(await repository.findAll()).toEqual([])
    expect(client.send.mock.calls[0][0].input.TableName).toBe('parameter-table')
  })

  it('maps items, including legacy items with no is_secret attribute (isSecret undefined)', async () => {
    const client = buildClient(async () => ({
      Items: [
        { parameter_id: { S: 'p1' }, value: { S: 'plain' }, is_secret: { BOOL: false }, updated_at: { S: 'a' }, updated_by: { S: 'admin@titvo.dev' } },
        { parameter_id: { S: 'legacy' }, value: { S: 'cli-value' } }
      ]
    }))
    const repository = new DynamoConfigRepository(client as any, 'parameter-table')

    const result = await repository.findAll()

    expect(result).toEqual([
      { parameterId: 'p1', value: 'plain', isSecret: false, updatedAt: 'a', updatedBy: 'admin@titvo.dev' },
      { parameterId: 'legacy', value: 'cli-value', isSecret: undefined, updatedAt: undefined, updatedBy: undefined }
    ])
  })
})

describe('DynamoConfigRepository.findById', () => {
  it('returns null when the item does not exist', async () => {
    const client = buildClient(async () => ({}))
    const repository = new DynamoConfigRepository(client as any, 'parameter-table')

    expect(await repository.findById('missing')).toBeNull()
  })

  it('gets the item by parameter_id and maps it', async () => {
    const client = buildClient(async () => ({
      Item: { parameter_id: { S: 'p1' }, value: { S: 'plain' }, is_secret: { BOOL: true }, updated_at: { S: 'a' }, updated_by: { S: 'b' } }
    }))
    const repository = new DynamoConfigRepository(client as any, 'parameter-table')

    expect(await repository.findById('p1')).toEqual({ parameterId: 'p1', value: 'plain', isSecret: true, updatedAt: 'a', updatedBy: 'b' })
    expect(client.send.mock.calls[0][0].input.Key).toEqual({ parameter_id: { S: 'p1' } })
  })
})

describe('DynamoConfigRepository.putNew', () => {
  it('puts a new item with a ConditionExpression guarding against overwrite', async () => {
    const client = buildClient(async () => ({}))
    const repository = new DynamoConfigRepository(client as any, 'parameter-table')

    await repository.putNew({ parameterId: 'p1', value: 'plain', isSecret: false, updatedAt: 'a', updatedBy: 'admin@titvo.dev' })

    const command = client.send.mock.calls[0][0]
    expect(command.input.ConditionExpression).toBe('attribute_not_exists(parameter_id)')
    expect(command.input.Item).toEqual({
      parameter_id: { S: 'p1' },
      value: { S: 'plain' },
      is_secret: { BOOL: false },
      updated_at: { S: 'a' },
      updated_by: { S: 'admin@titvo.dev' }
    })
  })

  it('translates a ConditionalCheckFailedException into ConfigAlreadyExistsError (no silent clobber)', async () => {
    const conditionalError = Object.assign(new Error('conflict'), { name: 'ConditionalCheckFailedException' })
    const client = buildClient(async () => { throw conditionalError })
    const repository = new DynamoConfigRepository(client as any, 'parameter-table')

    await expect(repository.putNew({ parameterId: 'p1', value: 'x', isSecret: false, updatedAt: 'a', updatedBy: 'b' }))
      .rejects.toThrow(ConfigAlreadyExistsError)
  })

  it('propagates an unrelated error unchanged (not masked as a conflict)', async () => {
    const client = buildClient(async () => { throw new Error('dynamodb unavailable') })
    const repository = new DynamoConfigRepository(client as any, 'parameter-table')

    await expect(repository.putNew({ parameterId: 'p1', value: 'x', isSecret: false, updatedAt: 'a', updatedBy: 'b' }))
      .rejects.toThrow('dynamodb unavailable')
  })
})

describe('DynamoConfigRepository.update', () => {
  it('updates is_secret/updated_at/updated_by but omits the value clause when value is undefined', async () => {
    const client = buildClient(async () => ({}))
    const repository = new DynamoConfigRepository(client as any, 'parameter-table')

    await repository.update('p1', { value: undefined, isSecret: false, updatedAt: 'a', updatedBy: 'b' })

    const command = client.send.mock.calls[0][0]
    expect(command.input.Key).toEqual({ parameter_id: { S: 'p1' } })
    expect(command.input.UpdateExpression).not.toContain('#value')
    expect(command.input.ExpressionAttributeValues).not.toHaveProperty(':value')
  })

  it('includes the value clause when value is provided', async () => {
    const client = buildClient(async () => ({}))
    const repository = new DynamoConfigRepository(client as any, 'parameter-table')

    await repository.update('p1', { value: 'new-value', isSecret: false, updatedAt: 'a', updatedBy: 'b' })

    const command = client.send.mock.calls[0][0]
    expect(command.input.UpdateExpression).toContain('#value')
    expect(command.input.ExpressionAttributeValues[':value']).toEqual({ S: 'new-value' })
  })
})
