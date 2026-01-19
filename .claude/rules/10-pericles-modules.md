---
paths:
  - "backend/src/**/*.ts"
  - "frontend/src/**/*.tsx"
  - "packages/**/*.ts"
---

# Pericles Product Modules

## Module Overview

| Module | Purpose |
|--------|---------|
| **Atlas** | Interactive global map showing shipments, suppliers, incidents |
| **Events** | Incident ingestion, lifecycle management, response coordination |
| **Insights** | Country and sector risk analytics, trend dashboards |
| **Plans** | Incident response planning, playbooks, compliance workflows |

## Atlas Module

Real-time global visualization of supply chain assets and risks.

**Core Features:**
- Interactive map with shipments, suppliers, warehouses
- Real-time incident overlay with severity indicators
- Route visualization for shipping lanes
- Geospatial filtering and proximity alerts

**Data Requirements:**
- Organization assets (lat/lon for all locations)
- Active shipments with routes
- Real-time incident feed
- Supplier risk scores

## Events Module

Central hub for incident management lifecycle.

**Event Lifecycle:**
```
DETECTED -> VALIDATING -> VALIDATED -> ASSESSING -> ASSESSED -> NOTIFYING -> RESOLVED
              |              |            |
              v              v            v
           INVALID      DUPLICATE    INCONCLUSIVE
```

**Core Features:**
- Incident ingestion from monitoring tools
- Deduplication via content hashing
- Severity and confidence scoring
- Response workflow triggers
- Audit trail and history

## Insights Module

Analytics and risk intelligence dashboard.

**Core Features:**
- Country risk scores with historical trends
- Sector/industry risk analysis
- Supplier risk portfolio view
- Custom KPI dashboards
- Export and reporting

**Risk Categories:**
- Political stability
- Economic indicators
- Natural disaster exposure
- Regulatory environment
- Infrastructure quality

## Plans Module

Proactive incident response and compliance management.

**Core Features:**
- Playbook templates for incident types
- Automated response workflows
- Stakeholder notification rules
- Compliance checklist tracking
- Post-incident review

**Playbook Structure:**
```typescript
interface Playbook {
  id: string;
  name: string;
  trigger_conditions: TriggerCondition[];
  steps: PlaybookStep[];
  escalation_rules: EscalationRule[];
  notification_templates: NotificationTemplate[];
}
```

## User Personas

| Persona | Primary Modules | Key Actions |
|---------|----------------|-------------|
| **Supply Chain Manager** | Atlas, Events | Monitor shipments, respond to incidents |
| **Risk Analyst** | Insights, Events | Analyze trends, assess supplier risk |
| **Operations Director** | All modules | Strategic oversight, reporting |
| **Compliance Officer** | Plans, Events | Audit trails, regulatory compliance |
