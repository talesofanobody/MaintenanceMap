import { Router } from "express";
import { prisma } from "../db";
import { serializeTechnician } from "./technicians";
import { costsByIssue } from "../lib/costs";
import { categoryLabel } from "../lib/taxonomy";
import { parseWeek, shiftHours } from "../lib/shifts";

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
      checklist: { select: { done: true } },
      tags: { include: { tag: { select: { name: true } } } },
      messages: { orderBy: { createdAt: "asc" } },
      guestReport: { select: { roomName: true } },
    },
    orderBy: [{ propertyId: "asc" }, { createdAt: "asc" }],
  });
  const costs = await costsByIssue(issues.map((i) => i.id));

  // Per-property numbering matches the workspace, report and boards.
  const counters = new Map<string, number>();
  const rows: Cell[][] = [
    [
      "Property",
      "Property address",
      "Issue #",
      "Title",
      "Category",
      "Room",
      "Tags",
      "Origin",
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
      "Checklist done",
      "Checklist steps",
      "Recorded costs",
      "Labour cost",
      "Total cost",
      "Work order created",
      "Work order number",
      "EAM link",
      "Description",
      "Action needed",
      "Messages",
      "Message thread",
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
      categoryLabel(i.category),
      i.roomName,
      i.tags.map((t) => t.tag.name).join(" | "),
      // How the job came to exist — worth knowing when counting what guests find for you.
      i.guestReport ? "Guest report" : i.scheduleId ? "Recurring schedule" : "Logged by staff",
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
      i.checklist.filter((c) => c.done).length,
      i.checklist.length,
      costs.get(i.id)?.recorded ?? 0,
      costs.get(i.id)?.labour ?? 0,
      costs.get(i.id)?.total ?? 0,
      i.workOrderCreated,
      i.workOrderNumber,
      i.workOrderUrl,
      i.description,
      i.actionNeeded,
      i.messages.length,
      // The whole conversation in one cell, oldest first, so nothing is lost in export.
      i.messages.map((m) => `${m.createdAt.toISOString().slice(0, 16).replace("T", " ")} ${m.authorName}: ${m.body}`).join("\n"),
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
    ["Name", "Trade", "Covers", "Phone", "Active", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Hours per week", "Open issues", "Open estimated hours", "Completed issues", "Completed actual hours", "Notes", "Technician ID"],
  ];
  for (const t of technicians) {
    const { weeklyHours, categories } = serializeTechnician(t);
    const week = parseWeek(t.weeklyHours);
    const open = t.issues.filter((i) => i.status !== "completed");
    const done = t.issues.filter((i) => i.status === "completed");
    rows.push([
      t.name,
      t.trade,
      categories.map(categoryLabel).filter(Boolean).join(" | "),
      t.phone,
      t.active,
      // The shift each day rather than a bare number, so the sheet reads like a rota.
      ...week.map((shift) => (shift ? `${shift.start}-${shift.end}` : "off")),
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

exportRouter.get("/costs.csv", async (req, res) => {
  const propertyId = req.query.propertyId ? String(req.query.propertyId) : undefined;
  const lines = await prisma.cost.findMany({
    where: propertyId ? { issue: { propertyId } } : undefined,
    include: {
      contractor: { select: { name: true, trade: true } },
      issue: { select: { title: true, priority: true, status: true, property: { select: { name: true } }, technician: { select: { name: true } } } },
    },
    orderBy: [{ incurredOn: "desc" }, { createdAt: "desc" }],
  });
  const rows: Cell[][] = [
    ["Date", "Property", "Issue", "Issue priority", "Issue status", "Technician", "Kind", "Description", "Contractor", "Contractor trade", "Invoice ref", "Unit amount", "Quantity", "Line total", "Recorded by", "Recorded at", "Cost ID"],
  ];
  for (const c of lines) {
    rows.push([
      c.incurredOn,
      c.issue.property.name,
      c.issue.title,
      c.issue.priority,
      c.issue.status,
      c.issue.technician?.name ?? "",
      c.kind,
      c.description,
      c.contractor?.name ?? "",
      c.contractor?.trade ?? "",
      c.invoiceRef,
      c.amount,
      c.quantity,
      Math.round(c.amount * c.quantity * 100) / 100,
      c.createdBy,
      c.createdAt.toISOString(),
      c.id,
    ]);
  }
  send(res, `maintenancemap-costs-${today()}.csv`, csv(rows));
});
