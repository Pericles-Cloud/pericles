# Pericles Build Skills — Dependency Map

A navigational artifact showing which skills depend on which. Generated from each
SKILL.md's `depends_on:` front-matter (2026-05-28). Reading order suggestion: top to
bottom — foundations first, then the spine, then specialized surfaces.

## Foundations (depended on by almost everything)

```
pericles-doctrine ─────────────────────────────────────► (root of all)
pericles-tech-stack ───────────────────────────────────► foundations + frontend + dev-env
pericles-data-model ───────────────────────────────────► most backend skills
pericles-tenant-isolation ─────────────────────────────► everything that touches data
pericles-mastra-tool ──────────────────────────────────► topical-skill, external-feeds, api
pericles-evals-scorers ────────────────────────────────► functional-agent, predictive, testing
pericles-observability ────────────────────────────────► admin-portal, compliance-audit, plans
pericles-prompts ──────────────────────────────────────► functional-agent, org-memory, intelligence
pericles-postgres-queue ───────────────────────────────► notifications, plans, monitoring-pipeline
pericles-repo-conventions ─────────────────────────────► dev-environment
```

## Skill System (the spine)

```
pericles-skill-authoring ◄── topical-skill, industry-skill, regional-skill, custom-skill
pericles-skill-registry  ◄── functional-agent, industry-pack, custom-skill, partner-marketplace
pericles-functional-agent ◄── monitoring-pipeline, predictive, copilot-ui, plans-ui
pericles-execution-node  ◄── notifications, plans-ui, copilot-ui, intelligence-ui,
                              assessments-ui, mobile, predictive
pericles-topical-skill   ◄── industry-pack, industry-skill, regional-skill
pericles-industry-skill  ◄── industry-pack, additional-packs
pericles-industry-pack   ◄── additional-packs
pericles-persona-layer   ◄── all UI skills (copilot, atlas, intelligence, admin, plans,
                              assessments, mobile, frontend-foundations)
```

## Backend / data / integrations

```
pericles-mcp-layer       ◄── org-memory, erp-adapter, external-feeds, custom-skill,
                              cross-customer-learning
pericles-monitoring-pipeline ◄── atlas-ui (events feed)
pericles-org-memory      ◄── intelligence-ui, assessments-ui, predictive,
                              cross-customer-learning
pericles-erp-adapter     ◄── admin-portal-ui, additional-packs
pericles-external-feeds  ◄── (used by topical-skill authors when adding new feeds)
```

## Frontend

```
pericles-frontend-foundations ◄── branding-ui, copilot-ui, atlas-ui, intelligence-ui,
                                   admin-portal-ui, plans-ui, assessments-ui, mobile
pericles-branding-ui     ◄── copilot-ui, atlas-ui, intelligence-ui, admin-portal-ui,
                             plans-ui, assessments-ui, mobile
                             (color/theme/type tokens + responsive & device rules)
pericles-copilot-ui      ◄── intelligence-ui, mobile
pericles-atlas-ui        ◄── (siblings)
pericles-intelligence-ui ◄── (siblings)
pericles-admin-portal-ui ◄── (siblings)
```

## Governance / cross-cutting

```
pericles-deployment-shapes     ◄── admin-portal-ui, compliance-audit, additional-packs
pericles-compliance-audit      ◄── additional-packs
pericles-security-threat-model ◄── custom-skill, partner-marketplace
```

## Post-MVP

```
pericles-custom-skill            ◄── partner-marketplace
pericles-cross-customer-learning ◄── predictive
pericles-additional-packs        ◄── (depends on the whole Skill System + adapters)
pericles-mobile                  ◄── (depends on frontend stack + execution-node)
pericles-predictive              ◄── (depends on functional-agent + evals + org-memory)
pericles-partner-marketplace     ◄── (depends on custom-skill + registry)
```

## Build process

```
pericles-testing          ◄── evals-scorers, security-threat-model, execution-node
pericles-api-conventions  ◄── frontend-foundations, mastra-tool, tenant-isolation
pericles-dev-environment  ◄── repo-conventions, tech-stack, postgres-queue
```

## Reading paths for common questions

- **"I'm building a new Topical monitor"** → tech-stack → mastra-tool → topical-skill → external-feeds → evals-scorers → testing.
- **"I'm building a new Functional Skill"** → doctrine (§4) → functional-agent → skill-authoring → skill-registry → evals-scorers → compliance-audit (architecture review).
- **"I'm building a UI surface"** → frontend-foundations → branding-ui → persona-layer → [surface] → execution-node (for actions) → api-conventions.
- **"I'm touching color, dark mode, type, or a mobile layout"** → branding-ui → frontend-foundations → mobile (if phone-facing).
- **"I'm shipping a new ERP adapter"** → erp-adapter → mcp-layer → data-model → tenant-isolation → testing.
- **"I'm enabling Custom Skills"** → custom-skill → security-threat-model → tenant-isolation → mcp-layer → skill-registry → compliance-audit.
- **"I'm onboarding to the codebase"** → dev-environment → repo-conventions → tech-stack → data-model → doctrine.
