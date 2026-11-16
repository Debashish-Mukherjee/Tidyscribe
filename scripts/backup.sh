#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
destination=${1:?Usage: scripts/backup.sh NEW_BACKUP_DIRECTORY}
# A new directory prevents accidentally replacing an earlier backup.
mkdir -p "$(dirname "$destination")"
mkdir "$destination"
docker compose exec -T postgres pg_dump -U postgres --format=custom docworkbench > "$destination/database.dump.part"
docker compose run --rm --no-deps -T backend tar -C /app/data -czf - exports > "$destination/exports.tar.gz.part"
mv "$destination/database.dump.part" "$destination/database.dump"
mv "$destination/exports.tar.gz.part" "$destination/exports.tar.gz"
printf 'Backup saved to %s\n' "$destination"
