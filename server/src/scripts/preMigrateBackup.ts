/**
 * Takes a backup immediately before a deploy applies new migrations.
 *
 * The nightly backup is not good enough for this moment. Deploy at three in the
 * afternoon and the most recent copy could be fifteen hours old — a whole day of
 * inspections sitting between the last safe point and the riskiest thing that
 * happens to this database. A SQLite migration rebuilds whole tables, so if one
 * is going to go wrong it goes wrong here.
 *
 * Run before `prisma migrate deploy`. It does nothing at all when there is
 * nothing pending, which is most deploys.
 */
import fs from "fs";
import path from "path";
import { prisma } from "../db";
import { createBackup } from "../lib/backup";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../prisma/migrations");

/** Migration folders in the build, in order. */
function onDisk(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * What the database says it has already applied, or null when it cannot say —
 * which means an empty volume on first boot, and there is nothing to lose yet.
 */
async function applied(): Promise<Set<string> | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
    );
    return new Set(rows.map((r) => r.migration_name));
  } catch {
    return null;
  }
}

/**
 * A backup that hangs would hang the deploy behind it, and a container that
 * never finishes starting is harder to diagnose than one that fails loudly.
 */
const TIMEOUT_MS = Number(process.env.PREMIGRATE_TIMEOUT_MS) > 0 ? Number(process.env.PREMIGRATE_TIMEOUT_MS) : 5 * 60 * 1000;

function withTimeout<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`the backup did not finish within ${Math.round(TIMEOUT_MS / 1000)}s`)), TIMEOUT_MS).unref()
    ),
  ]);
}

async function main(): Promise<void> {
  if (process.env.SKIP_PREMIGRATE_BACKUP === "1") {
    console.log("Pre-update backup skipped (SKIP_PREMIGRATE_BACKUP=1).");
    return;
  }

  const done = await applied();
  if (done === null) {
    console.log("No database yet — nothing to back up before the first migration.");
    return;
  }

  const pending = onDisk().filter((name) => !done.has(name));
  if (pending.length === 0) {
    console.log("No pending migrations — no pre-update backup needed.");
    return;
  }

  console.log(`${pending.length} migration${pending.length === 1 ? "" : "s"} pending: ${pending.join(", ")}`);
  console.log("Taking a backup before applying them…");
  const file = await withTimeout(createBackup(new Date(), "before-update"));
  console.log(`Pre-update backup written: ${file.name} (${Math.round(file.bytes / 1024)} KB, photos: ${file.includesPhotos})`);
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Pre-update backup FAILED:", err?.message ?? err);
    console.error("");
    console.error("Refusing to migrate without one. The database is untouched and the previous");
    console.error("deploy is still what ran last. Usual cause is a full volume — free some space,");
    console.error("or lower BACKUP_KEEP, and deploy again.");
    console.error("To override deliberately, set SKIP_PREMIGRATE_BACKUP=1 and redeploy.");
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
