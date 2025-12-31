#!/bin/sh
# Mastra Dev Startup Script
# Handles playground asset copying which is missing in some Mastra versions

set -e

echo "Installing dependencies..."
npm install

echo "Generating Prisma client..."
npx prisma generate

# Clear any stale playground assets that might cause conflicts
if [ -d ".mastra/output/playground" ]; then
  echo "Removing stale playground assets..."
  rm -rf .mastra/output/playground
fi

echo "Starting Mastra dev server..."
npx mastra dev &
MASTRA_PID=$!

# Wait for Mastra to fully initialize (check for index.mjs which indicates build complete)
echo "Waiting for Mastra build to complete..."
for i in $(seq 1 60); do
  if [ -f ".mastra/output/index.mjs" ]; then
    echo "Mastra build complete"
    # Wait a bit more for the server to start serving
    sleep 3
    break
  fi
  sleep 1
done

# Copy playground assets if they don't exist
if [ ! -f ".mastra/output/playground/index.html" ]; then
  echo "Copying playground assets..."
  if [ -d "node_modules/mastra/dist/playground" ]; then
    # Remove any partial playground directory
    rm -rf .mastra/output/playground 2>/dev/null || true
    cp -r node_modules/mastra/dist/playground .mastra/output/
    echo "Playground assets copied successfully"
  else
    echo "Warning: Playground assets not found in node_modules"
  fi
else
  echo "Playground already exists and is complete"
fi

# Wait for the Mastra process
wait $MASTRA_PID
