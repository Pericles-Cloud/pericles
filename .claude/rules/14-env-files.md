# Environment File Safety

## Never overwrite an env file without permission

**`.env`, `.env.local`, and any `.env*.local` file MUST NOT be overwritten,
truncated, or deleted without the user's explicit permission for that specific
action.**

These files hold secrets (API keys, database URLs, tokens) and local machine
config. They are gitignored, so a clobbered value is **not recoverable from git** —
losing one can silently break a developer's environment or leak/destroy a key.

### Forbidden without explicit permission
- `Write` to an existing `.env`/`.env.local`/`.env*.local`
- `cp … .env.local`, `mv … .env.local`, or any redirect that replaces it
  (`> .env.local`, `tee .env.local`)
- `rm` / truncation of these files
- `git checkout` / `git restore` that would discard local env changes

### Allowed without asking
- **Reading** the file to inspect which keys are set (never print secret values)
- **Appending** a new variable when it is clearly absent (prefer asking first if
  unsure)
- **Creating** the file when it does not exist (e.g. `cp .env.example .env.local`
  on a fresh setup — but confirm before overwriting an existing one)

### When a change is needed
Ask first, and prefer the least destructive path: tell the user the exact line to
add/change so they edit it themselves, or get explicit confirmation before writing.
If you must modify programmatically, append or do a targeted in-place edit of a
single key — never rewrite the whole file.

> Related: secrets handling in `.claude/rules/11-security.md` and the env-file
> hierarchy in `.claude/rules/01-core.md`.
