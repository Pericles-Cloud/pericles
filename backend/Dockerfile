# Pericles backend — Express API + WebSocket (socket.io /ws/workflow) in one
# process. Built for a persistent container host (Coolify, Render, Fly, a VM).
# One port serves the HTTP API and the WebSocket; config comes from env vars.
# syntax=docker/dockerfile:1.4

# =============================================================================
# Build stage — install deps & generate Prisma client
# =============================================================================
FROM node:20-alpine AS builder

# Install system deps for Prisma & healthcheck
# Use BuildKit cache mount for apk to speed up rebuilds
RUN --mount=type=cache,target=/var/cache/apk,sharing=locked \
    apk add --no-cache openssl ca-certificates curl python3 make g++

WORKDIR /app

# Install deps with npm cache mount
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm install --omit=optional --no-audit --no-fund --prefer-offline

# Generate Prisma client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy app source
COPY . .

# =============================================================================
# Runtime stage — minimal image with only production deps
# =============================================================================
FROM node:20-alpine AS runtime

# Runtime deps only
RUN apk add --no-cache openssl ca-certificates curl

WORKDIR /app

# Copy production deps and Prisma client from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY docker-entrypoint.sh ./docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 4112

# Entry point: migrations (API server only) and the program selected by
# APP_ENTRY, exec'd so Node is PID 1. See docker-entrypoint.sh.
CMD ["sh", "./docker-entrypoint.sh"]
