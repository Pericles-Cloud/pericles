# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pericles is a supply chain risk management SaaS platform with four core product modules:

- **Atlas**: Interactive global map (default landing page) showing shipments, suppliers, and incidents with real-time monitoring
- **Events**: Incident ingestion, lifecycle management, and response coordination
- **Insights**: Country and sector risk analytics with trend dashboards
- **Plans**: Incident response planning, playbooks, and compliance workflows

The platform uses an intelligent agent architecture:
- **Monitoring Agent**: Real-time data source monitoring for risk events
- **Validation Agent**: Multi-source event confirmation
- **Controller Agent**: Coordinates notifications and agent orchestration
- **Impact Assessment Agent**: Calculates financial impact from ERP data
- **Summarization Agent**: Maintains event summaries

## Tech Stack

- **Frontend**: React 19.1, TypeScript 5.8 (strict mode), Tailwind CSS, Vite 7.0
- **Backend**: Vercel serverless functions (@vercel/node), Prisma 6.12 ORM
- **Database**: PostgreSQL 16 (Docker for local), Neon serverless (production)
- **Auth**: JWT with refresh tokens, bcrypt (12 rounds), SAML SSO, Google OAuth
- **Maps**: Google Maps API (@googlemaps/js-api-loader)
- **Testing**: Playwright E2E with accessibility testing (@axe-core/playwright)

## Build & Development Commands

```bash
# Local development with Docker
npm run docker:up                  # Start PostgreSQL, pgAdmin, Redis
npm run dev:setup                  # Full local setup (docker + prisma + seed)
npm run dev:local                  # Setup + start dev server
npm run dev                        # Start Vite dev server

# Database
npm run prisma:generate           # Generate Prisma client
npm run prisma:migrate:dev        # Run migrations (development)
npm run prisma:migrate:deploy     # Deploy migrations (production)
npm run prisma:seed               # Seed database

# Build & Deploy
npm run build                     # Full build (prisma + tsc + vite)
npm run vercel-build              # Vercel-specific build
vercel                            # Deploy to staging
vercel --prod                     # Deploy to production

# Testing
npm run test:e2e:critical         # Critical E2E tests (deployment blockers)
npm run test:e2e:mobile           # Mobile device tests
npm run test:e2e:desktop          # Desktop browser tests
npm run test:pre-deploy           # Pre-deployment test suite
npm run test:a11y                 # Accessibility tests
```

## Architecture Patterns

### API Endpoints
All Vercel API functions follow this pattern:
- CORS headers with OPTIONS handling
- JWT authentication via Authorization header
- Role-based permission checks (Admin/Manager/Viewer for admin portal; Owner/Admin/Member/Guest for app)
- Audit logging for all mutations
- Prisma for database operations with proper `$disconnect()` cleanup

### Root Organization
- Users with `@pericles.cloud` email domain belong to root organization
- Root Admins have global manage permissions across all tenants
- Root non-admins have read-only access to all organizations
- Non-root users are strictly tenant-scoped

### Data Refresh Rates
- Events: 15 seconds (near real-time)
- Maritime/shipment positions: 30-60 minutes
- ERP sync: 30 minutes

### State Management
- React hooks with TypeScript types for screens and navigation
- Screen navigation pattern: `dashboard` → `search` → `results` → `detail`
- Debounced filter inputs (≥300ms)

## Git Conventions

Use conventional commit format:
```
feat(module): add feature description [TICKET-123]
fix(module): fix bug description [TICKET-124]
```

Branch naming:
```
feature/TICKET-123-description
fix/TICKET-124-description
hotfix/TICKET-125-description
```

## Version Management

Before any release:
1. Ask for release type (major/minor/patch)
2. Update `package.json` version
3. Version must match Git tags and GitHub releases
4. AboutComponent dynamically imports version from package.json

## Key Directories

- `api/` - Vercel serverless functions
- `src/components/` - React components
- `src/types/` - TypeScript interfaces
- `prisma/` - Database schema and migrations
- `tests/e2e/critical/` - Deployment-blocking E2E tests
- `.cursor/rules/` - Development standards documentation

## Security Requirements

- All endpoints enforce tenant isolation
- Audit log all admin actions, authentication events, and permission denials
- Never commit secrets - use environment variables
- SAML certificates validated before use
- File uploads scanned for malware before processing

## Testing Requirements

- Playwright tests run on Pixel 5, iPhone 12, Desktop Chrome, Desktop Safari
- WCAG 2.1 AA accessibility compliance required
- Critical E2E tests must pass before deployment
- Test user: `test@saas-app.com` / `testpass123` (created via seed)
