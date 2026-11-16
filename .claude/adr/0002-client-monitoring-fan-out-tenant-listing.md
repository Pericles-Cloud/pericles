# ADR-0002: Client Monitoring fan-out lists tenants (tenant-isolation exception)

## Status
Accepted

## Date
2026-11-16

## Context
The multi-tenancy rule (`CLAUDE.md`, `.claude/rules/01-core.md`) says every
database query must filter by `organization_id`.

The Global Monitoring Agent writes customer-agnostic Global Events. To turn one
global event change into per-customer exposure evaluations (issue #76), the
`client_monitoring` consumer has to decide **which tenants** to evaluate. That
decision is a tenant listing by nature and cannot be scoped to one
`organization_id`:

1. **Non-terminal event**: list monitoring-enabled customer organizations that
   have a Client Exposure Profile.
2. **Terminal event** (Resolved / Retracted / Merged): list the organizations
   that have an open `CandidateExposure` on that event, including organizations
   that have since turned monitoring off. Their exposures must still be cleared.

## Decision
Allow exactly these two tenant-listing queries in
`fanOutOrgIds` (`backend/src/workflow/consumers/client-monitoring.ts`), under
these constraints:

- They return **organization ids only** (`select: { id }` /
  `select: { organization_id }, distinct`). No tenant data is read.
- They run only for a **global** record (`organization_id === null`). An
  org-scoped record never fans out.
- Each listed organization gets its **own org-scoped record**
  (`target_organization_id === organization_id`). All evaluation, reads and
  writes for that org happen in that record, filtered by its
  `organization_id`, as the rule requires.
- No other query in the Client Monitoring path is exempt.

## Consequences

### Positive
- One global event change reaches every relevant tenant.
- Per-tenant work keeps the normal isolation guarantee and its own stage
  budget, lease and retries.

### Negative
- Two queries are exceptions to a "MUST" rule; reviewers and tooling will flag
  them, and this ADR is the reference.

### Neutral
- If a tenant-registry service is introduced later, these queries move there.

## Alternatives Considered
1. **Poll per tenant** (each org scans the Global Event Store): no cross-tenant
   query, but every org rescans every event; rejected as wasteful, and the
   Global Monitoring spec (§10, open question 1) chose push via change records.
2. **Fan out to all organizations unfiltered**: still a tenant listing, with
   more wasted work; does not avoid the exception.
3. **Store the exposure's org list on the Global Event**: would put
   tenant-identifying data on a global record, which Doctrine §9 forbids.
