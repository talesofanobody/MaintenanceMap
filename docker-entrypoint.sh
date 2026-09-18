#!/bin/sh
# Bring the database up to date before the app starts. `migrate deploy` only applies
# migrations that are already committed — it never invents one and never asks anything,
# so it is safe to run on every boot, including the first one on an empty volume.
set -e

mkdir -p /data/uploads /data/backups

echo "Applying database migrations…"
npx prisma migrate deploy

exec "$@"
