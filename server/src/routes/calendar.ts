import { randomBytes } from "crypto";
import { Router } from "express";
import { prisma } from "../db";
import { requireAuth } from "../middleware/requireAuth";
import { logActivity } from "../lib/activity";
import { OPEN_STATUSES } from "../lib/workflow";

export const calendarRouter = Router();

const PRIORITY_TAG: Record<string, string> = { urgent: "URGENT", high: "HIGH", medium: "MED", low: "LOW" };

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 asks for lines of at most 75 octets, continued with a leading space. */
function fold(line: string): string {
  if (line.length <= 73) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 73));
  rest = rest.slice(73);
  while (rest.length > 72) {
    parts.push(" " + rest.slice(0, 72));
    rest = rest.slice(72);
  }
  if (rest.length) parts.push(" " + rest);
  return parts.join("\r\n");
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function dayStamp(day: string): string {
  return day.replace(/-/g, "");
}

function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export async function ensureFeedToken(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { feedToken: true } });
  if (user?.feedToken) return user.feedToken;
  const token = randomBytes(24).toString("base64url");
  await prisma.user.update({ where: { id: userId }, data: { feedToken: token } });
  return token;
}

// The signed-in person's feed address.
calendarRouter.get("/feed", requireAuth, async (req, res) => {
  const token = await ensureFeedToken(req.user!.id);
  res.json({ token, path: `/api/calendar/${token}/maintenancemap.ics` });
});

calendarRouter.post("/feed/regenerate", requireAuth, async (req, res) => {
  const token = randomBytes(24).toString("base64url");
  await prisma.user.update({ where: { id: req.user!.id }, data: { feedToken: token } });
  await logActivity(req, { action: "user.feed_reset", entityType: "user", entityId: req.user!.id, summary: `${req.user!.username} reset their calendar feed link` });
  res.json({ token, path: `/api/calendar/${token}/maintenancemap.ics` });
});

/**
 * The feed itself. The token in the path is the credential, so this route is reachable
 * without a session — that is what lets a calendar app subscribe to it.
 */
calendarRouter.get("/:token/maintenancemap.ics", async (req, res) => {
  const token = req.params.token;
  if (!token || token.length < 16) return res.status(404).json({ error: "not found" });
  const user = await prisma.user.findFirst({
    where: { feedToken: token, active: true },
    select: { id: true, username: true, role: true, technicianId: true, technician: { select: { name: true } } },
  });
  if (!user) return res.status(404).json({ error: "not found" });

  // Technicians see their own work; admins see the whole crew's.
  const issues = await prisma.issue.findMany({
    where: {
      status: { in: OPEN_STATUSES },
      ...(user.role === "technician" ? { technicianId: user.technicianId ?? "none" } : {}),
    },
    include: { property: { select: { name: true, address: true } }, technician: { select: { name: true } }, checklist: { select: { done: true } } },
    orderBy: [{ scheduledFor: "asc" }, { dueDate: "asc" }],
  });

  const now = new Date();
  const name = `MaintenanceMap — ${user.technician?.name ?? user.username}`;
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MaintenanceMap//Maintenance calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    `NAME:${escapeText(name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  for (const issue of issues) {
    const day = issue.scheduledFor ?? issue.dueDate;
    if (!day) continue; // Undated work isn't a calendar entry.
    const details = [
      issue.description ?? "",
      issue.actionNeeded ? `To do: ${issue.actionNeeded}` : "",
      issue.technician ? `Technician: ${issue.technician.name}` : "Unassigned",
      issue.dueDate ? `Due: ${issue.dueDate}` : "",
      issue.estimatedHours != null ? `Estimate: ${issue.estimatedHours} h` : "",
      issue.checklist.length ? `Checklist: ${issue.checklist.filter((c) => c.done).length}/${issue.checklist.length} done` : "",
      issue.workOrderNumber ? `Work order: ${issue.workOrderNumber}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    lines.push(
      "BEGIN:VEVENT",
      `UID:issue-${issue.id}@maintenancemap`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${dayStamp(day)}`,
      `DTEND;VALUE=DATE:${dayStamp(nextDay(day))}`,
      fold(`SUMMARY:${escapeText(`[${PRIORITY_TAG[issue.priority] ?? issue.priority}] ${issue.title} · ${issue.property.name}`)}`),
      fold(`DESCRIPTION:${escapeText(details)}`),
      fold(`LOCATION:${escapeText([issue.property.name, issue.property.address].filter(Boolean).join(", "))}`),
      `GEO:${issue.lat};${issue.lng}`,
      `STATUS:${issue.status === "in_progress" ? "CONFIRMED" : "TENTATIVE"}`,
      `CATEGORIES:${issue.priority.toUpperCase()}`,
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  res.set("Content-Type", "text/calendar; charset=utf-8");
  res.set("Content-Disposition", 'inline; filename="maintenancemap.ics"');
  res.set("Cache-Control", "no-store");
  res.send(lines.join("\r\n") + "\r\n");
});
