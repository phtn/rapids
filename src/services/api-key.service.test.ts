import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { closeDatabase, getDatabase } from '../db/index.ts'
import { ApiKeyService } from './api-key.service.ts'

// Use in-memory database for tests
process.env.DB_PATH = ':memory:'

describe('ApiKeyService', () => {
  beforeEach(() => {
    // Clear all data between tests
    const db = getDatabase()
    db.run('DELETE FROM rate_limit_records')
    db.run('DELETE FROM api_keys')
  })

  afterAll(() => {
    closeDatabase()
  })

  describe('create', () => {
    test('creates an API key with default config', async () => {
      const result = await ApiKeyService.create()

      expect(result.key).toStartWith('rapids_')
      expect(result.key.length).toBe(39) // 7 prefix ("rapids_") + 32 random
      expect(result.record.id).toBeDefined()
      expect(result.record.prefix).toBe('rapids_')
      expect(result.record.isActive).toBe(true)
      expect(result.record.expiresAt).toBeNull()
    })

    test('creates an API key with custom prefix', async () => {
      const result = await ApiKeyService.create({ prefix: 'sk_test_' })

      expect(result.key).toStartWith('sk_test_')
      expect(result.record.prefix).toBe('sk_test_')
    })

    test('creates an API key with custom length', async () => {
      const result = await ApiKeyService.create({ prefix: 'x_', length: 16 })

      expect(result.key).toBe(`x_${result.key.slice(2)}`)
      expect(result.key.length).toBe(18) // 2 prefix + 16 random
    })

    test('creates an API key with expiration', async () => {
      const result = await ApiKeyService.create({ expiresIn: 3600 })

      expect(result.record.expiresAt).not.toBeNull()
      const expiresAt = result.record.expiresAt!
      const expectedExpiry = new Date(Date.now() + 3600 * 1000)

      // Allow 1 second tolerance
      expect(
        Math.abs(expiresAt.getTime() - expectedExpiry.getTime()),
      ).toBeLessThan(1000)
    })

    test('creates an API key with metadata and scopes', async () => {
      const result = await ApiKeyService.create({
        metadata: { userId: '123', tier: 'premium' },
        scopes: ['read', 'write'],
      })

      expect(result.record.metadata).toEqual({
        userId: '123',
        tier: 'premium',
      })
      expect(result.record.scopes).toEqual(['read', 'write'])
    })

    test('creates an API key with custom name', async () => {
      const result = await ApiKeyService.create({ name: 'Production API Key' })

      expect(result.record.name).toBe('Production API Key')
    })

    test('creates an API key with rate limit', async () => {
      const result = await ApiKeyService.create({ rateLimit: 100 })

      expect(result.record.rateLimit).toBe(100)
    })

    test('uses different charsets', async () => {
      const hexResult = await ApiKeyService.create({
        prefix: '',
        length: 32,
        charset: 'hex',
      })
      expect(hexResult.key).toMatch(/^[0-9a-f]+$/)

      const upperResult = await ApiKeyService.create({
        prefix: '',
        length: 32,
        charset: 'alphanumeric_upper',
      })
      expect(upperResult.key).toMatch(/^[A-Z0-9]+$/)

      const lowerResult = await ApiKeyService.create({
        prefix: '',
        length: 32,
        charset: 'alphanumeric_lower',
      })
      expect(lowerResult.key).toMatch(/^[a-z0-9]+$/)
    })
  })

  describe('validate', () => {
    test('validates a valid API key', async () => {
      const { key } = await ApiKeyService.create()

      const result = await ApiKeyService.validate(key)

      expect(result.valid).toBe(true)
      expect(result.key).toBeDefined()
      expect(result.reason).toBeUndefined()
    })

    test('rejects an invalid API key', async () => {
      const result = await ApiKeyService.validate('invalid_key_12345')

      expect(result.valid).toBe(false)
      expect(result.reason).toBe('not_found')
    })

    test('rejects an expired API key', async () => {
      const { key } = await ApiKeyService.create({ expiresIn: -1 })

      const result = await ApiKeyService.validate(key)

      expect(result.valid).toBe(false)
      expect(result.reason).toBe('expired')
    })

    test('rejects a revoked API key', async () => {
      const { key, record } = await ApiKeyService.create()
      ApiKeyService.revoke(record.id)

      const result = await ApiKeyService.validate(key)

      expect(result.valid).toBe(false)
      expect(result.reason).toBe('revoked')
    })

    test('updates last used time when validating', async () => {
      const { key, record } = await ApiKeyService.create()
      expect(record.lastUsedAt).toBeNull()

      await ApiKeyService.validate(key, { updateLastUsed: true })

      const updated = ApiKeyService.getById(record.id)
      expect(updated?.lastUsedAt).not.toBeNull()
    })

    test('respects updateLastUsed=false option', async () => {
      const { key, record } = await ApiKeyService.create()

      await ApiKeyService.validate(key, { updateLastUsed: false })

      const updated = ApiKeyService.getById(record.id)
      expect(updated?.lastUsedAt).toBeNull()
    })
  })

  describe('revoke', () => {
    test('revokes an API key', async () => {
      const { record } = await ApiKeyService.create()

      const success = ApiKeyService.revoke(record.id)

      expect(success).toBe(true)
      const updated = ApiKeyService.getById(record.id)
      expect(updated?.isActive).toBe(false)
    })

    test('returns false for non-existent key', () => {
      const success = ApiKeyService.revoke('non-existent-id')

      expect(success).toBe(false)
    })
  })

  describe('delete', () => {
    test('deletes an API key', async () => {
      const { record } = await ApiKeyService.create()

      const success = ApiKeyService.delete(record.id)

      expect(success).toBe(true)
      expect(ApiKeyService.getById(record.id)).toBeNull()
    })

    test('returns false for non-existent key', () => {
      const success = ApiKeyService.delete('non-existent-id')

      expect(success).toBe(false)
    })
  })

  describe('list', () => {
    test('lists all API keys', async () => {
      await ApiKeyService.create({ name: 'Key 1' })
      await ApiKeyService.create({ name: 'Key 2' })
      await ApiKeyService.create({ name: 'Key 3' })

      const keys = ApiKeyService.list()

      expect(keys.length).toBe(3)
    })

    test('filters by active status', async () => {
      await ApiKeyService.create({ name: 'Active' })
      const { record: revoked } = await ApiKeyService.create({
        name: 'Revoked',
      })
      ApiKeyService.revoke(revoked.id)

      const activeKeys = ApiKeyService.list({ isActive: true })
      const revokedKeys = ApiKeyService.list({ isActive: false })

      expect(activeKeys.length).toBe(1)
      expect(activeKeys[0]?.name).toBe('Active')
      expect(revokedKeys.length).toBe(1)
      expect(revokedKeys[0]?.name).toBe('Revoked')
    })

    test('filters by prefix', async () => {
      await ApiKeyService.create({ prefix: 'sk_' })
      await ApiKeyService.create({ prefix: 'pk_' })
      await ApiKeyService.create({ prefix: 'sk_' })

      const skKeys = ApiKeyService.list({ prefix: 'sk_' })

      expect(skKeys.length).toBe(2)
    })

    test('supports pagination', async () => {
      for (let i = 0; i < 10; i++) {
        await ApiKeyService.create({ name: `Key ${i}` })
      }

      const page1 = ApiKeyService.list({ limit: 3, offset: 0 })
      const page2 = ApiKeyService.list({ limit: 3, offset: 3 })

      expect(page1.length).toBe(3)
      expect(page2.length).toBe(3)
      expect(page1[0]?.id).not.toBe(page2[0]?.id)
    })
  })

  describe('updateMetadata', () => {
    test('updates metadata', async () => {
      const { record } = await ApiKeyService.create({
        metadata: { tier: 'free' },
      })

      ApiKeyService.updateMetadata(record.id, {
        tier: 'premium',
        extra: 'data',
      })

      const updated = ApiKeyService.getById(record.id)
      expect(updated?.metadata).toEqual({ tier: 'premium', extra: 'data' })
    })
  })

  describe('updateScopes', () => {
    test('updates scopes', async () => {
      const { record } = await ApiKeyService.create({ scopes: ['read'] })

      ApiKeyService.updateScopes(record.id, ['read', 'write', 'delete'])

      const updated = ApiKeyService.getById(record.id)
      expect(updated?.scopes).toEqual(['read', 'write', 'delete'])
    })
  })

  describe('rename', () => {
    test('renames an API key', async () => {
      const { record } = await ApiKeyService.create({ name: 'Old Name' })

      ApiKeyService.rename(record.id, 'New Name')

      const updated = ApiKeyService.getById(record.id)
      expect(updated?.name).toBe('New Name')
    })
  })

  describe('getStats', () => {
    test('returns correct statistics', async () => {
      // Create various keys
      await ApiKeyService.create() // Active
      await ApiKeyService.create() // Active
      const { record: toRevoke } = await ApiKeyService.create()
      ApiKeyService.revoke(toRevoke.id) // Revoked
      await ApiKeyService.create({ expiresIn: -1 }) // Expired

      const stats = ApiKeyService.getStats()

      expect(stats.total).toBe(4)
      expect(stats.active).toBe(2)
      expect(stats.revoked).toBe(1)
      expect(stats.expired).toBe(1)
    })
  })

  describe('rate limiting', () => {
    test('enforces rate limits', async () => {
      const { key } = await ApiKeyService.create({ rateLimit: 3 })

      // First 3 requests should pass
      expect((await ApiKeyService.validate(key)).valid).toBe(true)
      expect((await ApiKeyService.validate(key)).valid).toBe(true)
      expect((await ApiKeyService.validate(key)).valid).toBe(true)

      // 4th request should be rate limited
      const result = await ApiKeyService.validate(key)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('rate_limited')
    })

    test('allows requests when rate limit is not set', async () => {
      const { key } = await ApiKeyService.create({ rateLimit: null })

      // Many requests should all pass
      for (let i = 0; i < 100; i++) {
        const result = await ApiKeyService.validate(key)
        expect(result.valid).toBe(true)
      }
    })
  })
})
