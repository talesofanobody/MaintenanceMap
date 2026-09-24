/**
 * Refuses to start when the persistent volume is not actually there.
 *
 * Everything that must outlive a deploy — the database, the photos, the backups —
 * lives under one directory that the host is supposed to mount. Nothing in the
 * container can tell whether it did. `mkdir -p /data` succeeds either way: if the
 * volume is missing it quietly makes an ordinary directory in the container's
 * writable layer, and the app starts on an empty database as if it were a first
 * install.
 *
 * That is not theoretical. On 23 September a deploy started with the volume not
 * yet attached, applied all 21 migrations to a throwaway file, seeded it, and
 * served it for three minutes. When the volume did attach, the real database —
 * one migration behind — appeared under the running process, and the first
 * inspection query died on a column that had never been added to it. The crash
 * was the lucky part. Anything written in those three minutes went to a
 * filesystem that was about to be discarded, silently.
 *
 * So: look before the mkdir. A mounted volume is a filesystem of its own, which
 * is something we can check. Wait a little, in case the attach is merely slow,
 * then refuse — a deploy that does not start is a page in the log; a deploy that
 * starts on the wrong database is a day of work nobody can get back.
 */
import fs from "fs";

const target = process.argv[2] ?? "/data";

/**
 * The definitive answer on Linux: the kernel's own list of mount points. Returns
 * null where there is no /proc to read, which is not the same as "not mounted".
 */
function listedAsAMountPoint(dir: string): boolean | null {
  try {
    const raw = fs.readFileSync("/proc/self/mountinfo", "utf8");
    return raw.split("\n").some((line) => {
      // Field 5 is the mount point. Spaces in it are escaped as \040.
      const point = line.split(" ")[4];
      return !!point && point.replace(/\\040/g, " ") === dir;
    });
  } catch {
    return null;
  }
}

/** The portable answer: a mount is a different filesystem from the root one. */
function onItsOwnFilesystem(dir: string): boolean {
  try {
    return fs.statSync(dir).dev !== fs.statSync("/").dev;
  } catch {
    // Not there at all, which settles it.
    return false;
  }
}

/**
 * Either signal is taken as enough. The two failures are not equal: refusing a
 * volume that is really there stops a working deploy, while accepting one that is
 * not just returns us to the behaviour this script replaces. So when the checks
 * disagree, believe the one saying the storage is real.
 */
function mounted(dir: string): boolean {
  return listedAsAMountPoint(dir) === true || onItsOwnFilesystem(dir);
}

const WAIT_SECONDS = Number(process.env.DATA_MOUNT_WAIT_SECONDS ?? 60);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  if (process.env.ALLOW_EPHEMERAL_DATA === "1") {
    console.warn(`ALLOW_EPHEMERAL_DATA=1 — not checking that ${target} is a volume.`);
    console.warn("Everything in it will be lost on the next deploy. Fine for a demo, not for a property.");
    return;
  }

  if (mounted(target)) return;

  // An attach can lag the container by a few seconds. Worth waiting out; not
  // worth waiting forever, because a boot that never finishes is harder to
  // diagnose than one that fails.
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  if (WAIT_SECONDS > 0) {
    console.log(`${target} is not a mounted volume yet — waiting up to ${WAIT_SECONDS}s for it…`);
  }
  while (Date.now() < deadline) {
    await sleep(2000);
    if (mounted(target)) {
      console.log(`${target} mounted after ${Math.round((WAIT_SECONDS * 1000 - (deadline - Date.now())) / 1000)}s.`);
      return;
    }
  }

  console.error("");
  console.error(`REFUSING TO START: ${target} is not a mounted volume.`);
  console.error("");
  console.error("The database, the photos and the backups all live there. Without the mount they");
  console.error("would be written into the container and thrown away on the next deploy — and the");
  console.error("app would come up on an empty database looking like a fresh install, which is a");
  console.error("far worse way to find out.");
  console.error("");
  console.error(`  Railway    attach a Volume with mount path ${target}`);
  console.error(`  Compose    the app service needs a volume mounted at ${target}`);
  console.error(`  docker run add -v maintenancemap-data:${target}`);
  console.error("");
  console.error("If the storage really is meant to be temporary, set ALLOW_EPHEMERAL_DATA=1.");
  console.error("If the attach is just slow here, raise DATA_MOUNT_WAIT_SECONDS.");
  process.exit(1);
}

main().catch((err) => {
  console.error("Could not check the data volume:", err?.message ?? err);
  process.exit(1);
});
