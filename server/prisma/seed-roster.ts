/**
 * Adds the maintenance crew from prisma/roster.ts.
 *
 * Safe to run more than once: anyone already on the books is left exactly as they are,
 * so editing someone in the app and re-running this will not undo your edit. Run it with
 *
 *   npm run seed:roster            (from server/)
 *   docker compose exec app npx ts-node prisma/seed-roster.ts
 */
import { PrismaClient } from "@prisma/client";
import { ROSTER, TRADE_COLORS } from "./roster";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.technician.findMany({ select: { name: true } });
  const known = new Set(existing.map((t) => t.name.trim().toLowerCase()));

  let added = 0;
  let skipped = 0;
  for (const person of ROSTER) {
    if (known.has(person.name.trim().toLowerCase())) {
      skipped += 1;
      continue;
    }
    await prisma.technician.create({
      data: {
        name: person.name,
        trade: person.trade,
        color: TRADE_COLORS[person.trade] ?? "#2563eb",
        notes: person.notes ?? null,
        weeklyHours: JSON.stringify(person.week),
        categories: JSON.stringify(person.categories),
      },
    });
    added += 1;
  }

  console.log(`Roster: ${added} added, ${skipped} already on the books (${ROSTER.length} on the sheet).`);
  if (added) {
    console.log("Shifts are the pattern typical of each role, not a per-person transcription — check them on the Technicians page.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
