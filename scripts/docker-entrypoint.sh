#!/bin/sh
set -e

# Initialize data and upload directories
# In production (adapter-node), uploads go to client/ directory
mkdir -p /app/data /app/client/uploads/avatars /app/client/generated

# Run schema migration + seed on first boot (if DB doesn't exist)
if [ ! -f /app/data/ganbari-quest.db ]; then
  echo "First boot: initializing database..."
  npx drizzle-kit push
  npx tsx src/lib/server/db/seed.ts
  echo "Database initialized."
fi

exec "$@"
