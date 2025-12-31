#!/bin/sh
# Mastra Production Startup Script
# Builds and starts the Mastra server in production mode

set -e

echo "=== Mastra Production Build ==="
echo "Installing dependencies..."
npm install --omit=dev

echo "Generating Prisma client..."
npx prisma generate

echo "Building Mastra agents..."
npx mastra build

# Ensure Prisma client is available in the build output
if [ -d "node_modules/.prisma" ]; then
  echo "Copying Prisma client to build output..."
  mkdir -p .mastra/output/node_modules
  cp -r node_modules/.prisma .mastra/output/node_modules/
fi

# Copy @prisma/client if it exists
if [ -d "node_modules/@prisma" ]; then
  echo "Copying @prisma/client to build output..."
  mkdir -p .mastra/output/node_modules/@prisma
  cp -r node_modules/@prisma/client .mastra/output/node_modules/@prisma/
fi

echo "Starting Mastra server..."
npx mastra start
