/**
 * Refuses to start on an empty database when the volume says there was an install.
 *
 * "It asked me to create a new account" is what losing everything looks like from
 * the outside. The app shows that screen whenever the User table is empty, and
 * whoever answers it becomes an admin — so a database that has gone missing turns
 * silently into a fresh install, over the top of the real one, and the first sign
 * of trouble is a property manager wondering where their work went.
 *
 * The volume usually still knows better. Photos and backup archives sit beside the
 * database, and they do not disappear with it: a `DATABASE_URL` pointed somewhere
 * new, a volume attached late or attached empty, a database file lost — all of
 * them leave the photos and the archives exactly where they were. So an empty
 * database next to a full uploads folder is not a new install. It is a broken one,
 * and it should say so rather than offer a setup form.
 *
 * This is the second line. The first is requireDataVolume, which catches the
 * common cause — no mount at all. This one catches the rest, including the cases
 * nobody has thought of yet, because it tests the symptom rather than a cause.
 */
import fs from "fs";
import path from "path";
import { prisma } from "../db";

const BACKUP_DIR = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : null;
const UPLOADS_DIR = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : null;

const ARCHIVE = /^maintenancemap-\d{4}-\d{2}-\d{2}T\d{6}Z(-before-update|-before-restore)?\.(tar\.gz|db)$/;

function entries(dir: string | null, matching?: RegExp): string[] {
  if (!dir || !fs.existsSync(dir)) return [];
  try {
    const names = fs.readdirSync(dir);
    return matching ? names.filter((n) => matching.test(n)) : names;
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  if (process.env.ALLOW_EMPTY_DATABASE === "1" || process.env.ALLOW_EPHEMERAL_DATA === "1") {
    console.warn("Not checking whether this empty database should be empty (override set).");
    return;
  }

  let users: number;
  try {
    users = await prisma.user.count();
  } catch (err) {
    // Refusing here would mean a deploy bricked by a condition nobody predicted,
    // and the volume check has already done the important work. Say so and go on.
    console.warn("Could not check whether the database has accounts:", (err as Error)?.message ?? err);
    return;
  }

  if (users > 0) return;

  const archives = entries(BACKUP_DIR, ARCHIVE);
  const photos = entries(UPLOADS_DIR);
  if (archives.length === 0 && photos.length === 0) {
    console.log("Empty database, and nothing on the volume from a previous install — first run.");
    return;
  }

  // Newest first; the name sorts chronologically. A before-update copy is the one
  // worth naming, because it was taken at the last moment anything was at risk.
  const sorted = [...archives].sort().reverse();
  const suggestion = sorted.find((n) => n.includes("-before-update")) ?? sorted[0];

  console.error("");
  console.error("REFUSING TO START: the database has no accounts, but this volume has been used before.");
  console.error("");
  console.error(`  backup archives on the volume: ${archives.length}`);
  console.error(`  photo files on the volume:     ${photos.length}`);
  console.error("");
  console.error("Starting now would show the 'create your account' screen and let anyone who opens");
  console.error("the address set up a fresh install on top of the real one. The photos and the");
  console.error("archives above are still here, so the data is very likely recoverable — but not");
  console.error("if something writes over it first.");
  console.error("");
  console.error("Usual causes, in the order worth checking:");
  console.error("  1. DATABASE_URL was changed or injected by the platform, so the app is looking");
  console.error("     at a different file from the one the photos belong to.");
  console.error("  2. A volume was attached empty, or a second one was attached over the first.");
  console.error("  3. The database file was removed from the volume.");
  if (suggestion) {
    console.error("");
    console.error(`To put it back, restore this archive once the storage is right: ${suggestion}`);
    console.error("");
    console.error("Note that the restore screen is inside the app, which this check has just stopped");
    console.error("from starting. So: fix the storage first, then set ALLOW_EMPTY_DATABASE=1 for one");
    console.error("deploy to get in, restore from Settings -> Backups, and take the variable back out.");
    console.error("Restoring before the storage is right only writes the data back to the wrong place.");
  }
  console.error("");
  console.error("If instead this really is a fresh start and the old data is meant to go, the same");
  console.error("ALLOW_EMPTY_DATABASE=1 lets it through.");
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("Consistency check failed:", (err as Error)?.message ?? err);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
