# Pericles backend — Express API + WebSocket (socket.io /ws/workflow) in one
# process. Built for a persistent container host (Coolify, Render, Fly, a VM).
# One port serves the HTTP API and the WebSocket; config comes from env vars.
FROM node:20-slim

# Prisma needs openssl; ca-certificates for outbound TLS (Apify/Google/OpenAI).
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install ALL deps: tsx (the runtime) and the prisma CLI are devDependencies but
# are needed to run the server and apply migrations in the container. The
# postinstall hook (scripts/fix-mastra-provider-types.mjs) runs during `npm ci`,
# so scripts/ must be present first.
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --include=dev

# App source, then generate the Prisma client for this image's platform.
COPY . .
RUN npx prisma generate

ENV NODE_ENV=production
# The server listens on AUTH_PORT (default 4112). Override via the host if needed.
EXPOSE 4112

# Apply pending migrations, then start. The server reads DATABASE_URL,
# CORS_ORIGINS, JWT secrets, etc. from the container environment.
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx src/server/auth-server.ts"]
