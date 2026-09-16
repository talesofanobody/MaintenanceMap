import { prisma } from "../db";
import { dayFrom, daysBetween } from "./validation";
import { getSettings, nextPriority } from "./settings";
import { logActivity } from "./activity";
import { generateDueOccurrences } from "./schedules";
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
  const settings = await getSettings();
  // Recurring maintenance first, so freshly created jobs get today's reminders too.
  let created = await generateDueOccurrences(now);
  const open = await prisma.issue.findMany({
    where: { status: { not: "completed" } },
    include: {
      property: { select: { name: true } },
      technician: { select: { name: true, user: { select: { id: true, active: true } } } },
    },
  });

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

    // Running out of turnaround: warn the technician once a set share of the time has gone.
    if (issue.dueDate && issue.dueDate > today && techUser && settings.warnAtPercent > 0) {
      const startDay = issue.scheduledFor && issue.scheduledFor <= today ? issue.scheduledFor : dayFrom(issue.createdAt, 0);
      const total = daysBetween(startDay, issue.dueDate);
      const elapsed = daysBetween(startDay, today);
      if (total > 1 && elapsed / total >= settings.warnAtPercent / 100) {
        created += await notifyUsers([techUser], {
          ...base,
          kind: "due_soon",
          title: `Running out of time: ${issue.title}`,
          body: `${Math.round((elapsed / total) * 100)}% of the ${total}-day turnaround used · ${line}`,
          dedupeKey: `at_risk:${issue.id}:${issue.dueDate}`,
        });
      }
    }

    // Overdue long enough: raise the priority one level (and again every N days), so it climbs the boards.
    if (settings.escalation.enabled && issue.dueDate && issue.dueDate < today) {
      const overdueDays = daysBetween(issue.dueDate, today);
      const next = nextPriority(issue.priority);
      const sinceLast = issue.escalatedAt ? (now.getTime() - issue.escalatedAt.getTime()) / 86_400_000 : Infinity;
      const every = settings.escalation.afterOverdueDays;
      if (next && overdueDays >= every && sinceLast >= every) {
        await prisma.issue.update({ where: { id: issue.id }, data: { priority: next, escalatedAt: now } });
        await logActivity(null, {
          action: "issue.escalated",
          entityType: "issue",
          entityId: issue.id,
          issueId: issue.id,
          propertyId: issue.propertyId,
          summary: `"${issue.title}": Priority: ${issue.priority} → ${next} (automatic — overdue ${overdueDays} day${overdueDays === 1 ? "" : "s"})`,
        });
        created += await notifyUsers([techUser, ...admins], {
          ...base,
          kind: "priority",
          title: `Escalated to ${priorityWord(next)}: ${issue.title}`,
          body: `Overdue ${overdueDays} day${overdueDays === 1 ? "" : "s"} · ${issue.property.name}${issue.technician ? ` · ${issue.technician.name}` : " · unassigned"}`,
          dedupeKey: `escalate:${issue.id}:${next}:${today}`,
        });
      }
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

  // Someone still clocked in after ten hours has almost certainly forgotten.
  const stale = await prisma.timeEntry.findMany({
    where: { endedAt: null, startedAt: { lt: new Date(now.getTime() - 10 * 60 * 60 * 1000) } },
    include: { issue: { select: { title: true, propertyId: true } }, technician: { select: { user: { select: { id: true, active: true } } } } },
  });
  for (const entry of stale) {
    const uid = entry.technician.user?.active ? entry.technician.user.id : null;
    created += await notifyUsers([uid, ...admins], {
      kind: "status",
      title: `Still clocked in: ${entry.issue.title}`,
      body: `Clocked in since ${entry.startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC — clock out, or an admin can correct the entry.`,
      issueId: entry.issueId,
      propertyId: entry.issue.propertyId,
      dedupeKey: `timer:${entry.id}`,
    });
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
