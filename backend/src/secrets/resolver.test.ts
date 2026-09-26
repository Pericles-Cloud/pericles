/**
 * SecretsResolver scope-path construction.
 *
 * Both backends parse `org/{orgId}[/{scope}[/{scopeRef}]]` — the organization
 * id MUST be the second segment. Regression: paths were built as `org/<name>`
 * (no org id), so the backend treated the secret's name as an org id, matched
 * nothing, and every getOrgSecret call resolved to "not found" — which skipped
 * monitoring cycles for orgs whose key was in fact configured. Org-scope reads
 * also use `.../organization` to match the shape the secrets routes write
 * (Vault embeds scopePath verbatim in its KV key).
 */
import { describe, it, expect } from 'vitest';
import { SecretsResolver } from './resolver.js';
import { SecretError, ok, err, SecretScope } from './types.js';
import type { SecretsBackend, SecretMetadata } from './types.js';

const ORG = '644adb63-6e64-42d2-85d9-98a7c5691672';
const ORG_PATH = `org/${ORG}/organization`;

function makeBackend(hit?: (scopePath: string, name: string) => boolean) {
  const gets: Array<{ scopePath: string; name: string }> = [];
  const lists: string[] = [];
  const backend: SecretsBackend = {
    get: (scopePath: string, name: string) => {
      gets.push({ scopePath, name });
      const found = hit?.(scopePath, name);
      return Promise.resolve(
        found ? ok('sk-live') : err(new SecretError('NOT_FOUND', `no secret at ${scopePath}/${name}`))
      );
    },
    put: () => Promise.resolve(ok(undefined)),
    delete: () => Promise.resolve(ok(undefined)),
    list: (scopePath: string) => {
      lists.push(scopePath);
      return Promise.resolve(ok([] as SecretMetadata[]));
    },
    rotate: () => Promise.resolve(ok(undefined)),
  };
  return { backend, gets, lists };
}

/** Every attempted path must carry the org id as its second segment. */
function assertOrgScoped(gets: Array<{ scopePath: string; name: string }>) {
  for (const g of gets) {
    const parts = g.scopePath.split('/');
    expect(parts[0]).toBe('org');
    expect(parts[1]).toBe(ORG);
  }
}

describe('SecretsResolver.buildScopePaths', () => {
  it('resolves an org secret against org/{orgId}/organization (never org/<name>)', async () => {
    const { backend, gets, lists } = makeBackend(
      (p, n) => p === ORG_PATH && n === 'openrouter_api_key'
    );
    const resolver = new SecretsResolver(backend);

    const result = await resolver.resolve('org.openrouter_api_key', {
      organizationId: ORG,
      required: true,
    });

    expect(result.value).toBe('sk-live');
    expect(result.source.scope).toBe(SecretScope.ORGANIZATION);
    expect(gets).toEqual([{ scopePath: ORG_PATH, name: 'openrouter_api_key' }]);
    assertOrgScoped(gets);
    // getMetadata must list over the same scope path it read from
    expect(lists).toEqual([ORG_PATH]);
  });

  it('throws NOT_FOUND (required) when no scope has the secret', async () => {
    const { backend, gets } = makeBackend();
    const resolver = new SecretsResolver(backend);

    await expect(
      resolver.resolve('org.openrouter_api_key', { organizationId: ORG, required: true })
    ).rejects.toThrow('not found');
    expect(gets).toHaveLength(1);
    assertOrgScoped(gets);
  });

  it('returns defaultValue for a missing secret when not required', async () => {
    const { backend, gets } = makeBackend();
    const resolver = new SecretsResolver(backend);

    const result = await resolver.resolve('org.openrouter_api_key', {
      organizationId: ORG,
      required: false,
      defaultValue: 'fallback',
    });
    expect(result.value).toBe('fallback');
    // the attempt itself must have been org-scoped (fails on the old
    // `org/<secret-name>` path shape)
    expect(gets[0]?.scopePath).toBe(ORG_PATH);
  });

  it('walks tool → integration → org, all paths org-scoped', async () => {
    const { backend, gets } = makeBackend(
      (p) => p === `org/${ORG}/integration/intg-1`
    );
    const resolver = new SecretsResolver(backend);

    const result = await resolver.resolve('tool.api_key', {
      organizationId: ORG,
      toolId: 'tool-1',
      integrationId: 'intg-1',
      required: true,
    });

    expect(result.value).toBe('sk-live');
    expect(result.source.scope).toBe(SecretScope.INTEGRATION);
    expect(gets.map((g) => g.scopePath)).toEqual([
      `org/${ORG}/tool/tool-1`,
      `org/${ORG}/integration/intg-1`,
    ]);
    assertOrgScoped(gets);
  });

  it('falls back from integration scope to org scope', async () => {
    const { backend, gets } = makeBackend((p, n) => p === ORG_PATH && n === 'api_key');
    const resolver = new SecretsResolver(backend);

    const result = await resolver.resolve('integration.api_key', {
      organizationId: ORG,
      integrationId: 'intg-1',
      required: true,
    });

    expect(result.value).toBe('sk-live');
    expect(gets.map((g) => g.scopePath)).toEqual([
      `org/${ORG}/integration/intg-1`,
      ORG_PATH,
    ]);
    assertOrgScoped(gets);
  });

  it('accepts uppercase secret names (env-var-style user input)', async () => {
    const { backend, gets } = makeBackend(
      (p, n) => p === ORG_PATH && n === 'OPENROUTER_API_KEY'
    );
    const resolver = new SecretsResolver(backend);

    const result = await resolver.resolve('org.OPENROUTER_API_KEY', {
      organizationId: ORG,
      required: true,
    });
    expect(result.value).toBe('sk-live');
    expect(gets[0]).toEqual({ scopePath: ORG_PATH, name: 'OPENROUTER_API_KEY' });
  });
});
