import { prisma } from "../db";
import { dayFrom } from "./validation";
import { adminUserIds, issueLine, notifyUsers, priorityWord } from "./notify";

/**
 * Periodic checks that turn dates into reminders:
 *  - technicians hear about jobs starting today, due tomorrow, due today and overdue;
 *  - admins hear about overdue work and high/urgent issues nobody has picked up.
 * Every reminder carries a dedupe key so a run never repeats itself.
 */
export async function runScheduledChecks(now = new Date()): Promise<{ created: number; checked: number }> {
  const today = dayFrom(now, 0);
  const tomorrow = dayFrom(now, 1);
  const admins = await adminUserIds();
  const open = await prisma.issue.findMany({
    where: { status: { not: "completed" } },
    include: {
      property: { select: { name: true } },
      technician: { select: { name: true, user: { select: { id: true, active: true } } } },
    },
  });

  let created = 0;
  for (const issue of open) {
    const techUser = issue.technician?.user?.active ? issue.technician.user.id : null;
    const line = issueLine(issue, issue.property.name);
    const base = { issueId: issue.id, propertyId: issue.propertyId };

    if (issue.scheduledFor === today && techUser) {
      created += await notifyUsers([techUser], {
        ...base,
        kind: "starts_today",
        title: `Starts today: ${issue.title}`,
        body: line,
        dedupeKey: `starts_today:${issue.id}:${issue.scheduledFor}`,
      });
    }

    if (issue.dueDate === tomorrow && techUser) {
      created += await notifyUsers([techUser], {
        ...base,
        kind: "due_soon",
        title: `Due tomorrow: ${issue.title}`,
        body: line,
        dedupeKey: `due_soon:${issue.id}:${issue.dueDate}`,
      });
    }

    if (issue.dueDate === today) {
      // Unassigned work due today is the manager's problem.
      created += await notifyUsers(techUser ? [techUser] : admins, {
        ...base,
        kind: "due_today",
        title: `Due today: ${issue.title}`,
        body: techUser ? line : `${line} · unassigned`,
        dedupeKey: `due_today:${issue.id}:${issue.dueDate}`,
      });
    }

    if (issue.dueDate && issue.dueDate < today) {
      created += await notifyUsers([techUser, ...admins], {
        ...base,
        kind: "overdue",
        title: `Overdue: ${issue.title}`,
        body: `${line}${issue.technician ? ` · ${issue.technician.name}` : " · unassigned"}`,
        // Re-dating an overdue issue resets the reminder.
        dedupeKey: `overdue:${issue.id}:${issue.dueDate}`,
      });
    }

    const ageMs = now.getTime() - issue.createdAt.getTime();
    if (!issue.technicianId && (issue.priority === "urgent" || issue.priority === "high") && ageMs > 60 * 60 * 1000) {
      created += await notifyUsers(admins, {
        ...base,
        kind: "unassigned",
        title: `${priorityWord(issue.priority)} issue needs a technician: ${issue.title}`,
        body: line,
        dedupeKey: `unassigned:${issue.id}`,
      });
    }
  }

  return { created, checked: open.length };
}

/** Old read notifications are cleared so the table doesn't grow forever. */
export async function purgeOldNotifications(now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  await prisma.notification.deleteMany({ where: { readAt: { not: null }, at: { lt: cutoff } } });
}

export function startScheduler(intervalMs = 15 * 60 * 1000): void {
  const tick = () =>
    runScheduledChecks()
      .then((r) => {
        if (r.created) console.log(`Scheduler: ${r.created} reminder(s) from ${r.checked} open issue(s).`);
      })
      .then(() => purgeOldNotifications())
      .catch((err) => console.error("scheduler failed", err));
  setTimeout(tick, 3000).unref();
  setInterval(tick, intervalMs).unref();
}
