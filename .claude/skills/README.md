# Pericles Build Skills

`SKILL.md` knowledge folders that guide developers and coding agents in building the
Pericles supply-chain risk platform without drifting from the Platform Doctrine.
Intended to be committed into `Pericles-Cloud/pericles` (suggested home: `.claude/skills/`
or `/skills/`) and mirrored under **Product Docs → Build Skills** in Notion.

## Status — all skills complete (2026-05-28; `pericles-branding-ui` added 2026-07-28)

W0 (10) + W1 (22) + W1.5 (4) + Post-MVP (6) + Build process (3) = **45 build skills**,
all reconciled against the live repo (`CLAUDE.md`, `backend/package.json`,
`prisma/schema.prisma`, `backend/src/*`, the `.claude/rules` + `.cursor/rules`
libraries). The repo-side master list is `pericles-skills-master-list.md`; the live
tracker is the Notion **Skills Master List & MVP Checklist** page. The dependency map
is `DEPENDENCIES.md`.

## Convention

```
pericles-<name>/
  SKILL.md          # front-matter (name, version, description, doctrine_refs, depends_on, last_reconciled) + body
  templates/        # copy-paste scaffolds, where useful
  references/       # deeper material, where useful
```
Each skill is calendar-versioned (`YYYY.MM.N`), carries a `last_reconciled` date, and
ends with Open questions + Changelog. A stale `last_reconciled` is the signal to re-audit
(mirrors Doctrine §11).

## W0 — Foundations (10)

`pericles-doctrine` · `-tech-stack` · `-repo-conventions` · `-mastra-tool` (+template) ·
`-data-model` · `-tenant-isolation` · `-evals-scorers` (+template) · `-observability` ·
`-prompts` · `-postgres-queue`

## W1 — MVP spine (22)

**Skill System:** `pericles-skill-authoring` (+manifest template) · `-skill-registry` ·
`-functional-agent` · `-execution-node` · `-topical-skill` · `-industry-skill` ·
`-industry-pack` (+pack template) · `-persona-layer`
**Backend / data / integrations:** `pericles-mcp-layer` · `-monitoring-pipeline` ·
`-org-memory` · `-erp-adapter` · `-external-feeds`
**Frontend:** `pericles-frontend-foundations` · `-branding-ui` · `-copilot-ui` ·
`-atlas-ui` · `-intelligence-ui` · `-admin-portal-ui`
**Governance:** `pericles-deployment-shapes` · `-compliance-audit` (+ADR template) ·
`-security-threat-model`

## W1.5 — MVP completion (4)

`pericles-regional-skill` · `-notifications` · `-plans-ui` · `-assessments-ui`

## Post-MVP (6)

`pericles-custom-skill` · `pericles-cross-customer-learning` · `pericles-additional-packs`
(pharma / automotive / food & ag / retail / energy) · `pericles-mobile` ·
`pericles-predictive` · `pericles-partner-marketplace`

## Build process (3)

`pericles-testing` · `pericles-api-conventions` · `pericles-dev-environment` — added
beyond the original plan to close real gaps: testing strategy + Vitest wiring; the API
request/response/scoping conventions; and the docker-compose + npm-script + `.env.local`
onboarding surface.

## Key current-state findings (from reconciliation)

The repo already contains more than the architecture docs implied — several skills
"extend what exists" rather than greenfield:
- **Workflow engine** (`backend/src/workflow/` + `Workflow*` models + reactflow) = the Execution Node + Plans foundation.
- **SAP adapter** (`backend/src/integrations/sap/` + SAP Mastra tools) = the ERP-adapter template.
- **Auth + RBAC** (auth-server, JWT/Google OAuth, `UserOrganization` OWNER/ADMIN/MEMBER/GUEST).
- **Postgres `MessageQueue` + `KeyValueStore`** (+ `queue-client.ts`), `MonitoringAuditLog`/`AuthAuditLog`.
- **Tools** put `organization_id` in `inputSchema` (validated via `context`); scorers use `createScorer` from `@mastra/core/scores`.
- **`.mcp.json` holds one server** (`apify-importyeti`) → MCP (§5) is otherwise greenfield.
- **`.cursor/rules`** is a generic library (its Kafka/Redis/VoltAgent/Neon files are NOT in use; `CLAUDE.md` + `package.json` are authoritative).
- **`validation-client.ts` is a stub** → the Validation Agent (PoC) is not wired yet.

## Recurring open questions worth a platform-team decision

- Where the **registry** lives and how manifests are packaged (no `registry/` yet).
- The **Validation Agent** contract that replaces the `validation-client.ts` stub.
- Canonical `UserOrganization` **role → Admin-Portal tier** mapping.
- Which data sources migrate to **MCP** first (Org Memory stores are the strongest candidates).
- The Custom Skill **sandbox runtime** + library allow-list (gates Custom Skills shipping).
- The **differential-privacy mechanism** that gates §9 Phase 2 (cross-customer learning).
