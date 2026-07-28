/**
 * resolveMastraStoreConfig — SSL decision and timeout defaults (Vitest).
 *
 * Regression guard: the Mastra store used to force `sslmode=require` + an `ssl`
 * option whenever NODE_ENV was production, which broke against the internal
 * Coolify Postgres (plaintext) with "The server does not support SSL
 * connections". SSL must follow the connection string, not the deploy env.
 */
import { describe, it, expect } from 'vitest';
import { resolveMastraStoreConfig } from './db-client.js';

const INTERNAL = 'postgres://mastra:pw@yf4wqoi7qjqartfif5xwjvao:5432/mastra';

describe('resolveMastraStoreConfig — SSL', () => {
  it('does NOT use SSL for an internal URL with no sslmode', () => {
    // The production failure: this is exactly the Coolify internal DB shape.
    expect(resolveMastraStoreConfig(INTERNAL).useSsl).toBe(false);
  });

  it('uses SSL when the URL requires it', () => {
    for (const mode of ['require', 'verify-ca', 'verify-full']) {
      expect(resolveMastraStoreConfig(`${INTERNAL}?sslmode=${mode}`).useSsl).toBe(true);
    }
  });

  it('does not use SSL for sslmode values that permit plaintext', () => {
    for (const mode of ['disable', 'allow', 'prefer']) {
      expect(resolveMastraStoreConfig(`${INTERNAL}?sslmode=${mode}`).useSsl).toBe(false);
    }
  });

  it('does not depend on NODE_ENV', () => {
    // The whole point of the fix: the same URL yields the same decision
    // regardless of environment. Exercised by setting NODE_ENV around the call.
    const prev = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const prod = resolveMastraStoreConfig(INTERNAL).useSsl;
      process.env.NODE_ENV = 'development';
      const dev = resolveMastraStoreConfig(INTERNAL).useSsl;
      expect(prod).toBe(false);
      expect(dev).toBe(false);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe('resolveMastraStoreConfig — timeouts', () => {
  it('sets default connect/statement/pool timeouts when absent', () => {
    const params = new URL(resolveMastraStoreConfig(INTERNAL).connectionString).searchParams;
    expect(params.get('connect_timeout')).toBe('30');
    expect(params.get('statement_timeout')).toBe('30000');
    expect(params.get('pool_timeout')).toBe('30');
  });

  it('does not clobber timeouts already set in the URL', () => {
    const params = new URL(
      resolveMastraStoreConfig(`${INTERNAL}?connect_timeout=5`).connectionString
    ).searchParams;
    expect(params.get('connect_timeout')).toBe('5');
  });

  it('preserves an existing sslmode rather than overwriting it', () => {
    const params = new URL(
      resolveMastraStoreConfig(`${INTERNAL}?sslmode=require`).connectionString
    ).searchParams;
    expect(params.get('sslmode')).toBe('require');
  });

  it('never injects sslmode when the URL omits it', () => {
    // The old code did `set('sslmode','require')`. It must not reappear.
    const params = new URL(resolveMastraStoreConfig(INTERNAL).connectionString).searchParams;
    expect(params.has('sslmode')).toBe(false);
  });
});
