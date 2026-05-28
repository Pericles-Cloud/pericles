---
name: pericles-dev-environment
version: 2026.05.0
description: >
  How to set up and work in the Pericles dev environment — docker-compose services, the
  .env.local convention, the canonical npm scripts (dev:all, monitoring:start, prisma,
  mocker, jobs:cleanup), and the pre-commit gate. Use this WHENEVER onboarding a
  developer, adding a service, or wiring CI. Encodes the existing docker-compose
  (postgres, pgadmin, mastra), the dotenv-from-repo-root pattern, and the mandatory
  lint + type-check before merge.
doctrine_refs: [Ops §1, §2; §11]
depends_on: [pericles-repo-conventions, pericles-tech-stack, pericles-postgres-queue]
last_reconciled: 2026-05-28
---

# Pericles Dev Environment (build skill)

Pericles' local stack is small and deliberate: a Postgres container, pgAdmin, and the
Mastra runtime. Everything else (the monitoring process, the auth-server, the frontend)
runs via npm scripts that pull env from a single `.env.local` at the repo root. This
skill keeps developer onboarding consistent and prevents drift.

## When to use this skill

Onboarding a developer; adding/changing a docker-compose service; adding a new npm
script; wiring CI; debugging an env-loading or local-Postgres issue.

## docker-compose services

`docker-compose.yml` ships three services:

- **postgres** (`postgres:16-alpine`) — the primary store; healthcheck via `pg_isready`.
  Schema is managed by Prisma (`pericles-data-model`).
- **pgadmin** (`dpage/pgadmin4`) — convenience admin UI; depends on `postgres` being
  healthy.
- **mastra** (`node:20-alpine`) — the Mastra runtime container for local dev.

`docker compose up -d` brings them up; the healthcheck gates the dependents.

## The .env.local convention

Every script loads env via `dotenv -e ../.env.local …` from `backend/`, so the
**canonical env file lives at the repo root**, not inside `backend/`. Required keys
include `DATABASE_URL`, `OPENAI_API_KEY`, optional feed keys
(`THENEWSAPI_API_KEY`, `TWITTERAPIIO_API_KEY`, `OPENWEATHER_API_KEY`,
`MARINETRAFFIC_API_KEY`, …), and runtime knobs (`MONITORING_DEFAULT_INTERVAL_MS`,
`LOG_LEVEL`). Never commit `.env.local`; never put secrets in any committed file.

## Canonical npm scripts (backend)

| Script | What it does |
|---|---|
| `dev` | `mastra dev` (the Mastra playground/runtime on 4111) |
| `dev:auth` | `tsx watch` the Express auth-server |
| **`dev:all`** | runs both via `concurrently` (the common path) |
| `monitoring:start` | the per-org monitoring runner (`pericles-monitoring-pipeline`) |
| `prisma:generate` / `migrate:dev` / `migrate:deploy` / `seed` / `studio` | schema lifecycle |
| `mock:create` / `mock:reset` / `mock:status` / `mock:help` | the scripted mock data lifecycle (`pericles-erp-adapter`) |
| `jobs:cleanup` | `data-retention-cleanup.ts` (audit-log hot-tier retention) |
| `lint` / `lint:fix` / `lint:strict` | ESLint (TS/TSX); `:strict` = `--max-warnings 0` |
| `format` / `format:check` | Prettier |
| `type-check` | `tsc --noEmit` |

**Pre-commit:** husky + `lint-staged` is wired (`prepare` script). The pre-commit gate
runs lint/format on staged files; CI runs `lint`, `type-check`, and (once wired,
`pericles-testing`) `test`.

## Mandatory before opening a PR

`cd backend && npm run lint && npm run type-check` (from `CLAUDE.md`). Failing either
blocks merge. When `pericles-testing` is wired, `npm test` joins this list.

## Frontend dev

`cd frontend && npm run dev` runs Next.js 16 on the default port; lint/format/type-check
mirror the backend conventions (`pericles-frontend-foundations`).

## Resetting local state

`docker compose down -v` + `npm run prisma:migrate:dev` + `npm run mock:reset` returns
to a clean tenant with seeded mock data. Don't `prisma migrate reset` on shared envs.

## What this forbids

Committing `.env.local` or any secret; running scripts without `dotenv -e ../.env.local`;
opening a PR without lint + type-check passing; hard-coding ports/secrets in
docker-compose; bypassing husky/lint-staged with `--no-verify` as a habit.

## Verification

`docker compose up -d` brings up healthy services; `npm run dev:all` runs Mastra + auth
concurrently; `prisma migrate dev` succeeds against the local Postgres; the mocker
creates a usable tenant; pre-commit blocks unlinted code; CI runs lint + type-check
(+ test once wired).

## Existing standards (read alongside)

`docker-compose.yml`; `backend/package.json#scripts`; `CLAUDE.md` (mandatory checks);
`pericles-repo-conventions`, `pericles-tech-stack`.

## Open questions

- Adding `vitest` to the canonical script set (`pericles-testing`) — currently a
  placeholder.
- A unified `make dev` (or `npm run dev:all` from the repo root) so a single command
  brings up docker + backend + frontend.

## Changelog

- 2026.05.0 — Initial draft from `docker-compose.yml`, `backend/package.json`, and the
  `CLAUDE.md` checks; flagged the missing test wiring.
