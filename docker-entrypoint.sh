#!/bin/sh
# Bring the database up to date before the app starts. `migrate deploy` only applies
# migrations that are already committed — it never invents one and never asks anything,
# so it is safe to run on every boot, including the first one on an empty volume.
set -e

# Everything worth keeping lives on the volume, and nothing in here can tell
# whether the host actually mounted one: the mkdir below succeeds either way, and
# a missing mount would have the app come up on an empty database looking like a
# first install. Check before creating anything.
echo "Checking the data volume…"
node dist/scripts/requireDataVolume.js /data

mkdir -p /data/uploads /data/backups

# A migration rebuilds whole tables in SQLite, so it is the single riskiest thing
# that happens to this database. Take a copy of it first — but only when there is
# actually something pending, which most deploys will not have. A failure here
# stops the boot on purpose: better a deploy that does not start than one that
# migrates with no way back.
echo "Checking for pending migrations…"
node dist/scripts/preMigrateBackup.js

echo "Applying database migrations…"
npx prisma migrate deploy

exec "$@"
