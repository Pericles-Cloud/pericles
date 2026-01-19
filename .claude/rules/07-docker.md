---
paths:
  - "**/Dockerfile*"
  - "**/docker-compose*.yml"
  - "**/.dockerignore"
---

# Docker Standards

## Multi-Stage Dockerfile

```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS runner
WORKDIR /app

# Security: non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

COPY --from=builder --chown=appuser:nodejs /app/dist ./dist
COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules

USER appuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
```

## Docker Compose (Local Development)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: pericles
      POSTGRES_PASSWORD: pericles_dev
      POSTGRES_DB: pericles
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pericles"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  mastra:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "4111:4111"
    environment:
      - DATABASE_URL=postgresql://pericles:pericles_dev@postgres:5432/pericles
      - REDIS_URL=redis://redis:6379
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

volumes:
  postgres_data:
```

## Local Service Ports

| Service | Port | Credentials |
|---------|------|-------------|
| PostgreSQL | 5432 | pericles / pericles_dev |
| pgAdmin | 5050 | admin@pericles.dev / admin |
| Redis | 6379 | - |
| Mastra Dev | 4111 | - |
| Mastra Prod | 3001 | - |

## Security Requirements

- Always run containers as non-root user
- Use specific version tags, never `latest`
- Include health checks for orchestration
- Scan images for vulnerabilities
- Don't copy secrets into images

## .dockerignore

```
node_modules
.git
.env*
*.log
dist
.next
coverage
.DS_Store
```
