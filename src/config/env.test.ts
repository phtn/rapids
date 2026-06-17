import { describe, expect, test } from 'bun:test'
import { Cause, Effect, Option } from 'effect'
import {
  type ConfigError,
  InvalidPort,
  MissingApiKey,
  configErrorMessage,
  loadConfig,
} from './env.ts'

function runConfig(env: NodeJS.ProcessEnv) {
  return Effect.runSyncExit(loadConfig(env))
}

describe('loadConfig', () => {
  test('succeeds with valid env (default port and cors)', () => {
    const exit = runConfig({ API_KEY: 'secret-key' })

    expect(exit._tag).toBe('Success')
    if (exit._tag === 'Success') {
      expect(exit.value.host).toBe('0.0.0.0')
      expect(exit.value.port).toBe(3000)
      expect(exit.value.adminApiKey).toBe('secret-key')
      expect(exit.value.corsOrigins).toBe('*')
      expect(exit.value.dbPath).toBe('rapids.db')
    }
  })

  test('succeeds with custom HOST and DB_PATH', () => {
    const exit = runConfig({
      API_KEY: 'key',
      HOST: '127.0.0.1',
      DB_PATH: './data/rapids.db',
    })

    expect(exit._tag).toBe('Success')
    if (exit._tag === 'Success') {
      expect(exit.value.host).toBe('127.0.0.1')
      expect(exit.value.dbPath).toBe('./data/rapids.db')
    }
  })

  test('succeeds with valid custom PORT', () => {
    const exit = runConfig({ API_KEY: 'key', PORT: '8080' })

    expect(exit._tag).toBe('Success')
    if (exit._tag === 'Success') {
      expect(exit.value.port).toBe(8080)
    }
  })

  test('succeeds with custom CORS_ORIGINS (comma-separated)', () => {
    const exit = runConfig({
      API_KEY: 'key',
      CORS_ORIGINS: 'https://a.com, https://b.com',
    })

    expect(exit._tag).toBe('Success')
    if (exit._tag === 'Success') {
      expect(exit.value.corsOrigins).toEqual(['https://a.com', 'https://b.com'])
    }
  })

  test('succeeds when CORS_ORIGINS is *', () => {
    const exit = runConfig({ API_KEY: 'key', CORS_ORIGINS: '*' })

    expect(exit._tag).toBe('Success')
    if (exit._tag === 'Success') {
      expect(exit.value.corsOrigins).toBe('*')
    }
  })

  test('trims admin API key', () => {
    const exit = runConfig({ API_KEY: '  trimmed  ' })

    expect(exit._tag).toBe('Success')
    if (exit._tag === 'Success') {
      expect(exit.value.adminApiKey).toBe('trimmed')
    }
  })

  test('fails with MissingApiKey when API_KEY is missing', () => {
    const exit = runConfig({})

    expect(exit._tag).toBe('Failure')
    if (exit._tag === 'Failure') {
      const err = Option.getOrThrow(
        Cause.failureOption(exit.cause),
      ) as ConfigError
      expect(err._tag).toBe('MissingApiKey')
    }
  })

  test('fails with MissingApiKey when API_KEY is empty string', () => {
    const exit = runConfig({ API_KEY: '' })

    expect(exit._tag).toBe('Failure')
    if (exit._tag === 'Failure') {
      const err = Option.getOrThrow(
        Cause.failureOption(exit.cause),
      ) as ConfigError
      expect(err._tag).toBe('MissingApiKey')
    }
  })

  test('fails with MissingApiKey when API_KEY is only whitespace', () => {
    const exit = runConfig({ API_KEY: '   ' })

    expect(exit._tag).toBe('Failure')
    if (exit._tag === 'Failure') {
      const err = Option.getOrThrow(
        Cause.failureOption(exit.cause),
      ) as ConfigError
      expect(err._tag).toBe('MissingApiKey')
    }
  })

  test('fails with InvalidPort when PORT is not a number', () => {
    const exit = runConfig({ API_KEY: 'key', PORT: 'abc' })

    expect(exit._tag).toBe('Failure')
    if (exit._tag === 'Failure') {
      const err = Option.getOrThrow(
        Cause.failureOption(exit.cause),
      ) as ConfigError
      expect(err._tag).toBe('InvalidPort')
      if (err._tag === 'InvalidPort') {
        expect(err.value).toBe('abc')
        expect(err.message).toContain('Expected an integer 1-65535')
      }
    }
  })

  test('fails with InvalidPort when PORT is out of range (too low)', () => {
    const exit = runConfig({ API_KEY: 'key', PORT: '0' })

    expect(exit._tag).toBe('Failure')
    if (exit._tag === 'Failure') {
      const err = Option.getOrThrow(
        Cause.failureOption(exit.cause),
      ) as ConfigError
      expect(err._tag).toBe('InvalidPort')
      if (err._tag === 'InvalidPort') {
        expect(err.value).toBe('0')
      }
    }
  })

  test('fails with InvalidPort when PORT is out of range (too high)', () => {
    const exit = runConfig({ API_KEY: 'key', PORT: '70000' })

    expect(exit._tag).toBe('Failure')
    if (exit._tag === 'Failure') {
      const err = Option.getOrThrow(
        Cause.failureOption(exit.cause),
      ) as ConfigError
      expect(err._tag).toBe('InvalidPort')
      if (err._tag === 'InvalidPort') {
        expect(err.value).toBe('70000')
      }
    }
  })

  test('succeeds with PORT at boundaries (1 and 65535)', () => {
    const exit1 = runConfig({ API_KEY: 'key', PORT: '1' })
    const exit65535 = runConfig({ API_KEY: 'key', PORT: '65535' })

    expect(exit1._tag).toBe('Success')
    expect(exit65535._tag).toBe('Success')
    if (exit1._tag === 'Success') expect(exit1.value.port).toBe(1)
    if (exit65535._tag === 'Success') expect(exit65535.value.port).toBe(65535)
  })
})

describe('configErrorMessage', () => {
  test('returns message for MissingApiKey', () => {
    const msg = configErrorMessage(new MissingApiKey({}))
    expect(msg).toBe(
      'Missing API_KEY. Set API_KEY in environment before starting the server.',
    )
  })

  test('returns message for InvalidPort', () => {
    const msg = configErrorMessage(
      new InvalidPort({
        value: 'bad',
        message: 'Invalid PORT value "bad". Expected 1-65535.',
      }),
    )
    expect(msg).toBe('Invalid PORT value "bad". Expected 1-65535.')
  })
})
