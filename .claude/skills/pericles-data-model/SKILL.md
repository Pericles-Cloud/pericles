---
name: pericles-data-model
version: 2026.05.1
description: >
  How to model data in Pericles with Prisma + PostgreSQL. Use this WHENEVER you add
  or change a table, a query, or a migration. Encodes the real schema: organization_id
  on every tenant table, the Event(validation_status) → Incident lifecycle, EventHash
  TTL dedup, the MonitoringAuditLog/AuthAuditLog audit tables, the MessageQueue +
  KeyValueStore infrastructure tables, and UserOrganization RBAC — no Kafka, no Redis.
doctrine_refs: [§2, §9; Security §2; Ops §1–§2]
depends_on: [pericles-mastra-tool, pericles-tenant-isolation]
last_reconciled: 2026-05-28
---

# Pericles Data Model (build skill)

Postgres is system of record, queue, and KV store. The model must be safe for strict
multi-tenancy and regulated-industry audit from day one. This skill reflects the
**actual** `backend/prisma/schema.prisma`.

> **Existing rules:** `.claude/rules/05-database.md`,
> `.cursor/rules/500-architecture/506-postgresql-core-standards-auto.mdc`,
> `.cursor/rules/500-architecture/502-prisma-typescript-rules-auto.mdc`.

## Rule 1 — `organization_id` on every tenant table and query

Every tenant row carries `organization_id` (snake_case) with an index (often
composite, e.g. `@@index([organization_id, status])`), an FK to `Organization` with
`onDelete: Cascade`, and every query filters on it. System/global rows use a nullable
`organization_id`. It comes from the authenticated session (`pericles-tenant-isolation`).

## Rule 2 — the real event lifecycle: Event → Incident

The pipeline is **one `Event` table with a `validation_status`**, not separate
candidate/validated tables:

- **`Event`** — raw detected events. `validation_status` ∈ `pending | validated |
  rejected | duplicate`. Carries `event_hash`; unique on `[organization_id,
  event_hash]` and `[organization_id, title, source, type]` (content de-dup).
- **`Incident`** — validated events promoted to incidents (`incident_number` like
  `INC-2025-0001`); `status` ∈ `open | investigating | resolved | closed`.
- **`RiskAssessment`** — agent-generated analysis, linked to an event.
- **`EventHash`** — dedup tracking with `expires_at` (TTL); unique `[organization_id,
  hash]`; index `[organization_id, expires_at]`.

`post_validation` Skills read validated `Event`s / `Incident`s, never the raw signal —
the `validation_status` boundary is "the one defensible version of the truth"
(`pericles-functional-agent`).

## Rule 3 — audit tables exist; keep them append-only

- **`MonitoringAuditLog`** — `event_type` (monitoring_cycle / source_fetch /
  deduplication / error), `source`, `status` (success/failure/partial), counts
  (events_detected/filtered/published, duplicates_found), `duration_ms`,
  error_message/stack, `metadata` Json. The existing monitoring audit record.
- **`AuthAuditLog`** — auth events (event_status SUCCESS/FAILURE).

Treat both as append-only (no app edit/delete path). The full per-invocation Skill
lineage schema (Ops Spec) extends these — see `pericles-observability`. Retention per
manifest `governance.audit_retention_days` (`pericles-compliance-audit`); a
`data-retention-cleanup` job already exists (`npm run jobs:cleanup`).

## Rule 4 — Postgres is the queue and KV store (models already exist)

Do not add Kafka or Redis. The infrastructure tables are present:

- **`MessageQueue`** — `queue_name`, `message_type`, `payload` Json, `status`
  (`MessageStatus`, default PENDING), `attempts`/`max_attempts` (default 3),
  `scheduled_at`/`processed_at`/`failed_at`, `error_message`. Indexes
  `[queue_name, status]`, `[status, scheduled_at]`.
- **`KeyValueStore`** — `key`, `value` Json, `namespace` (default "default", e.g.
  "cache"/"queue"/"session"), `expires_at` (TTL); unique `[organization_id,
  namespace, key]`.

Use these via the existing clients (`pericles-postgres-queue`); do not introduce
parallel job/cache tables.

## Rule 5 — RBAC and org hierarchy

- **`UserOrganization`** — user↔org with `role` (OWNER/ADMIN/MEMBER/GUEST) and status;
  unique `[user_id, organization_id]`. This is the RBAC substrate.
- **`Organization`** — `is_root` (global-access root) and `parent_organization_id`
  hierarchy. **`DataSourceToolConfig`** — per-org enablement of monitoring tools
  (`[organization_id, data_source, tool_id]`, `enabled`).

## Rule 6 — cross-customer signal is per-tenant + privacy-preserving (§9)

Signal for cross-customer learning is extracted per tenant with differential-privacy
budgets; aggregation never via direct cross-tenant query (`pericles-org-memory`).

## What this forbids

A tenant table without `organization_id` + index; reading `organization_id` from an
unauthenticated source; mutable audit rows; cross-tenant aggregation without §9 infra;
introducing Kafka/Redis or parallel queue/KV tables alongside MessageQueue/KeyValueStore.

## Verification

Migrations reviewed for: `organization_id` + index on every tenant table; correct
`validation_status`/`status` transitions on Event/Incident; EventHash TTL; append-only
audit tables; reuse of MessageQueue/KeyValueStore; no Kafka/Redis. `npm run type-check`
+ `npm run lint` pass (mandatory per CLAUDE.md).

## Existing standards (read alongside)

`CLAUDE.md` (Database Schema, Multi-Tenancy); `.claude/rules/05-database.md`;
`.cursor/rules/500-architecture/{502-prisma-typescript,506-postgresql}-*.mdc`.

## Open questions

- Whether `Incident` fully supersedes `Event` for closed/historical events, or both
  are retained as archive — confirm intended retention with the platform team.

## Changelog

- 2026.05.1 — Reconciled against schema.prisma: real models (Event/validation_status,
  Incident, EventHash TTL, MonitoringAuditLog/AuthAuditLog, MessageQueue, KeyValueStore,
  UserOrganization, DataSourceToolConfig, org hierarchy/is_root). Replaced the assumed
  candidate/validated table split.
- 2026.05.0 — Initial draft.
