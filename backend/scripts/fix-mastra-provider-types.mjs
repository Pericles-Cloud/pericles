#!/usr/bin/env node
/**
 * Sanitize @mastra/core's generated provider-types file.
 *
 * Why this exists:
 *   `@mastra/core` ships a clean, valid `provider-types.generated.d.ts`, but the
 *   model-router tooling can REGENERATE that file locally from the live model
 *   gateway (models.dev). The generator does not quote object keys that begin
 *   with a digit (e.g. the `302ai` provider), emitting invalid TypeScript:
 *
 *       readonly 302ai: readonly [ ... ]   // TS1351: identifier cannot follow a numeric literal
 *
 *   One such key derails the parser and produces hundreds of cascading parse
 *   errors that `skipLibCheck` cannot suppress, breaking `npm run type-check`.
 *
 * What this does:
 *   Idempotently quotes any unquoted digit-leading `readonly <key>:` property.
 *   - On the pristine published file there are no such keys, so it is a no-op.
 *   - On a regenerated file it quotes them (`302ai` -> `'302ai'`), restoring valid TS.
 *
 * Wired into `postinstall` and `pretype-check` so a regeneration cannot silently
 * re-break the build. Always exits 0 (never blocks install/type-check itself).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(
  here,
  '../node_modules/@mastra/core/dist/llm/model/provider-types.generated.d.ts',
);

try {
  if (!existsSync(target)) {
    // Package not installed yet (e.g. install ordering) — nothing to do.
    process.exit(0);
  }

  const original = readFileSync(target, 'utf8');

  // Match a `readonly <key>:` property whose key starts with a digit and is NOT
  // already quoted, anchored on a boundary (line start, brace, comma, or space)
  // so it works whether the key is on its own line or inline:
  //   `  readonly 302ai: readonly [`  ->  `  readonly '302ai': readonly [`
  const KEY = /(^|[\s{(,;])(readonly )(\d[A-Za-z0-9_$.-]*)(\??\s*:)/gm;
  const fixed = original.replace(KEY, "$1$2'$3'$4");

  if (fixed !== original) {
    writeFileSync(target, fixed, 'utf8');
    const count = (original.match(KEY) || []).length;
    console.log(
      `[fix-mastra-provider-types] Quoted ${count} unquoted digit-leading provider key(s) in provider-types.generated.d.ts`,
    );
  }
} catch (err) {
  // Never fail the install or type-check because of this guard.
  console.warn(`[fix-mastra-provider-types] skipped: ${err?.message ?? err}`);
}

process.exit(0);
