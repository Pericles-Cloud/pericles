# Pericles backend — Express API + WebSocket (socket.io /ws/workflow) in one
# process. Built for a persistent container host (Coolify, Render, Fly, a VM).
# One port serves the HTTP API and the WebSocket; config comes from env vars.
# syntax=docker/dockerfile:1.4

# =============================================================================
# Build stage — install deps & generate Prisma client
# =============================================================================
FROM node:20-alpine AS builder

# Install system deps for Prisma & healthcheck
RUN apk add --no-cache openssl ca-certificates curl python3 make g++

WORKDIR /app

# Install deps
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm install --omit=optional --no-audit --no-fund

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

ENV NODE_ENV=production
EXPOSE 4112

# Run migrations then start
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx src/server/auth-server.ts"]