#!/usr/bin/env bash
# Reset guess cooldown for a user in the active challenge.
# Usage: ./reset-cooldown.sh [user_id] [challenge_id]
#   - No args: reset cooldown for ALL users in ALL challenges
#   - user_id only: reset that user's cooldown across all challenges
#   - user_id + challenge_id: reset that user's cooldown for one challenge
#
# This does NOT delete guesses — it only clears the created_at timestamps
# so the 30-min cooldown check passes. Scores and letter state are preserved.

set -euo pipefail

CONTAINER=$(docker compose ps -q bot 2>/dev/null || docker ps -q --filter "name=hitormiss-bot" 2>/dev/null)

if [ -z "$CONTAINER" ]; then
  echo "❌ Bot container not found. Is it running?"
  exit 1
fi

DB_PATH="/app/data/hitormiss.db"

# Build SQL based on args
SQL="UPDATE guesses SET created_at = 0"
if [ $# -ge 1 ]; then
  SQL+=" WHERE user_id = '$1'"
  if [ $# -ge 2 ]; then
    SQL+=" AND challenge_id = $2"
  fi
fi

echo "🔄 Running: $SQL"
docker exec "$CONTAINER" node -e "
const Database = require('better-sqlite3');
const db = new Database('$DB_PATH');
const result = db.prepare(\`$SQL\`).run();
console.log('✅ Updated ' + result.changes + ' row(s)');
db.close();
"
