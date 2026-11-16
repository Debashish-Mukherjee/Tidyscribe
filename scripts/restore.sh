#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source_dir=${1:?Usage: scripts/restore.sh BACKUP_DIRECTORY}
test -f "$source_dir/database.dump"
test -f "$source_dir/exports.tar.gz"
# Restore into an empty database. Existing installations must use a new Compose project.
tables=$(docker compose exec -T postgres psql -U postgres -d docworkbench -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
if [ "$tables" != 0 ]; then
  printf 'Restore requires an empty database. Use a fresh Compose project.\n' >&2
  exit 1
fi
docker compose exec -T postgres pg_restore -U postgres -d docworkbench --exit-on-error < "$source_dir/database.dump"
docker compose run --rm --no-deps -T backend tar -C /app/data -xzf - < "$source_dir/exports.tar.gz"
printf 'Database and exports restored. Start the application services to apply any newer migrations.\n'
