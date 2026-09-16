import { Router } from "express";
import { prisma } from "../db";
import { serializeTechnician } from "./technicians";

export const exportRouter = Router();

type Cell = string | number | boolean | null | undefined;

function csv(rows: Cell[][]): string {
  const escape = (v: Cell) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM so Excel opens it as UTF-8; CRLF line endings per RFC 4180.
  return "﻿" + rows.map((r) => r.map(escape).join(",")).join("\r\n") + "\r\n";
}

function send(res: import("express").Response, filename: string, body: string) {
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="${filename}"`);
  res.set("Cache-Control", "no-store");
  res.send(body);
}

const today = () => new Date().toISOString().slice(0, 10);

exportRouter.get("/issues.csv", async (req, res) => {
  const propertyId = req.query.propertyId ? String(req.query.propertyId) : undefined;
  const issues = await prisma.issue.findMany({
    where: propertyId ? { propertyId } : undefined,
    include: {
      property: { select: { name: true, address: true } },
      technician: { select: { name: true, trade: true } },
      photos: { select: { id: true }, orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ propertyId: "asc" }, { createdAt: "asc" }],
  });

  // Per-property numbering matches the workspace, report and boards.
  const counters = new Map<string, number>();
  const rows: Cell[][] = [
    [
      "Property",
      "Property address",
      "Issue #",
      "Title",
      "Priority",
      "Status",
      "Technician",
      "Trade",
      "Start date",
      "Due date",
      "Logged at",
      "Closed at",
      "Days to resolve",
      "Estimated hours",
      "Actual hours",
      "Work order created",
      "Work order number",
      "EAM link",
      "Description",
      "Action needed",
      "Comments",
      "Latitude",
      "Longitude",
      "Photos",
      "Photo files",
      "Issue ID",
    ],
  ];
  for (const i of issues) {
    const n = (counters.get(i.propertyId) ?? 0) + 1;
    counters.set(i.propertyId, n);
    const daysToResolve = i.closedAt ? Math.round(((i.closedAt.getTime() - i.createdAt.getTime()) / 86400000) * 10) / 10 : null;
    rows.push([
      i.property.name,
      i.property.address,
      n,
      i.title,
      i.priority,
      i.status,
      i.technician?.name ?? "",
      i.technician?.trade ?? "",
      i.scheduledFor,
      i.dueDate,
      i.createdAt.toISOString(),
      i.closedAt ? i.closedAt.toISOString() : "",
      daysToResolve,
      i.estimatedHours,
      i.actualHours,
      i.workOrderCreated,
      i.workOrderNumber,
      i.workOrderUrl,
      i.description,
      i.actionNeeded,
      i.comments,
      i.lat,
      i.lng,
      i.photos.length,
      i.photos.map((p) => `/api/photos/${p.id}/file`).join(" | "),
      i.id,
    ]);
  }
  send(res, `maintenancemap-issues-${today()}.csv`, csv(rows));
});

exportRouter.get("/technicians.csv", async (_req, res) => {
  const technicians = await prisma.technician.findMany({
    orderBy: { name: "asc" },
    include: { issues: { select: { status: true, estimatedHours: true, actualHours: true, scheduledFor: true, dueDate: true } } },
  });
  const rows: Cell[][] = [
    ["Name", "Trade", "Phone", "Active", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Hours per week", "Open issues", "Open estimated hours", "Completed issues", "Completed actual hours", "Notes", "Technician ID"],
  ];
  for (const t of technicians) {
    const { weeklyHours } = serializeTechnician(t);
    const open = t.issues.filter((i) => i.status !== "completed");
    const done = t.issues.filter((i) => i.status === "completed");
    rows.push([
      t.name,
      t.trade,
      t.phone,
      t.active,
      ...weeklyHours,
      weeklyHours.reduce((a, b) => a + b, 0),
      open.length,
      open.reduce((s, i) => s + (i.estimatedHours ?? 0), 0),
      done.length,
      done.reduce((s, i) => s + (i.actualHours ?? 0), 0),
      t.notes,
      t.id,
    ]);
  }
  send(res, `maintenancemap-technicians-${today()}.csv`, csv(rows));
});
