import { describe, expect, test } from 'bun:test'
import { extractAuthToken, secureCompare } from './auth.ts'

describe('auth helpers', () => {
  describe('extractAuthToken', () => {
    test('extracts bearer token', () => {
      const req = new Request('http://localhost/test', {
        headers: { Authorization: 'Bearer token_123' },
      })
      expect(extractAuthToken(req)).toBe('token_123')
    })

    test('extracts ApiKey token', () => {
      const req = new Request('http://localhost/test', {
        headers: { Authorization: 'ApiKey token_123' },
      })
      expect(extractAuthToken(req)).toBe('token_123')
    })

    test('returns null for invalid format', () => {
      const req = new Request('http://localhost/test', {
        headers: { Authorization: 'Token token_123' },
      })
      expect(extractAuthToken(req)).toBeNull()
    })
  })

  describe('secureCompare', () => {
    test('returns true for equal values', () => {
      expect(secureCompare('abc123', 'abc123')).toBe(true)
    })

    test('returns false for different values', () => {
      expect(secureCompare('abc123', 'abc124')).toBe(false)
    })

    test('returns false for different lengths', () => {
      expect(secureCompare('abc123', 'abc1234')).toBe(false)
    })
  })
})
