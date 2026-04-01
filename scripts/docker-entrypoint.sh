#!/bin/sh
set -e

# Initialize data and upload directories
# In production (adapter-node), uploads go to client/ directory
mkdir -p /app/data /app/client/uploads/avatars /app/client/generated

# Schema validation and safe auto-migration now runs on every startup
# via client.ts (SQL_CREATE_TABLES with IF NOT EXISTS + validateAndMigrate).
# First boot seeding only runs when DB doesn't exist yet.
if [ ! -f /app/data/ganbari-quest.db ]; then
  echo "First boot: initializing database..."
  npx drizzle-kit push
  npx tsx src/lib/server/db/seed.ts
  echo "Database initialized."
fi

exec "$@"
