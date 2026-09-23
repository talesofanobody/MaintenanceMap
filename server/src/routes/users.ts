import { Router } from "express";
import { prisma } from "../db";
import { hashPassword } from "../lib/passwords";
import { logActivity } from "../lib/activity";
import { isValidPassword, isValidUsername } from "./auth";
import { canActOnUser, canManageRole, isRole, ROLE_LABELS, ROLES as ALL_ROLES } from "../lib/permissions";
import { requires } from "../middleware/requireAuth";

export const usersRouter = Router();

const ROLES = new Set<string>(ALL_ROLES);

/** The roles this person is allowed to hand out, named for an error message. */
function grantable(actor: string): string {
  const list = ALL_ROLES.filter((r) => canManageRole(actor, r)).map((r) => ROLE_LABELS[r]);
  return list.length ? list.join(", ") : "none";
}

const USER_SELECT = {
  id: true,
  username: true,
  role: true,
  technicianId: true,
  technician: { select: { id: true, name: true, color: true, trade: true } },
  active: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

async function activeAdminCount(excludeId?: string): Promise<number> {
  return prisma.user.count({ where: { role: "admin", active: true, ...(excludeId ? { id: { not: excludeId } } : {}) } });
}

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({ select: USER_SELECT, orderBy: [{ role: "asc" }, { username: "asc" }] });
  res.json(users);
});

usersRouter.post("/", async (req, res) => {
  const { username, password, role, technicianId } = req.body;
  if (!isValidUsername(username)) return res.status(400).json({ error: "Username must be 3-60 characters." });
  if (!isValidPassword(password)) return res.status(400).json({ error: "Password must be at least 8 characters." });
  if (!isRole(role) || !ROLES.has(role)) return res.status(400).json({ error: `Role must be one of: ${ALL_ROLES.map((r) => ROLE_LABELS[r]).join(", ")}.` });
  // A manager may make a technician login but not an admin one. Without this,
  // "one step below admin" is only one login away from being admin.
  if (!canManageRole(req.user!.role, role)) {
    return res.status(403).json({ error: `You can create logins for: ${grantable(req.user!.role)}.` });
  }

  let linkedTechnicianId: string | null = null;
  if (role === "technician") {
    if (!technicianId || typeof technicianId !== "string") return res.status(400).json({ error: "Pick the technician this login belongs to." });
    const tech = await prisma.technician.findUnique({ where: { id: technicianId }, include: { user: true } });
    if (!tech) return res.status(404).json({ error: "technician not found" });
    if (tech.user) return res.status(409).json({ error: `${tech.name} already has a login (${tech.user.username}).` });
    linkedTechnicianId = tech.id;
  }

  const taken = await prisma.user.findUnique({ where: { username: username.trim() } });
  if (taken) return res.status(409).json({ error: "That username is already in use." });

  const user = await prisma.user.create({
    data: {
      username: username.trim(),
      passwordHash: await hashPassword(password),
      role,
      technicianId: linkedTechnicianId,
      mustChangePassword: true,
    },
    select: USER_SELECT,
  });
  await logActivity(req, {
    action: "user.created",
    entityType: "user",
    entityId: user.id,
    summary: `Created ${role} login ${user.username}${user.technician ? ` for ${user.technician.name}` : ""}`,
  });
  res.status(201).json(user);
});

usersRouter.put("/:id", async (req, res) => {
  const { active, role, password, technicianId } = req.body;
  const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "not found" });
  const isSelf = existing.id === req.user!.id;

  if (role !== undefined && (!isRole(role) || !ROLES.has(role))) return res.status(400).json({ error: "invalid role" });
  // Two separate questions: may you touch this account as it stands, and may you
  // move it to the role asked for. Checking only the second would let a manager
  // reset an admin's password and sign in as them.
  if (!isSelf && !canActOnUser(req.user!.role, existing.role)) {
    return res.status(403).json({ error: `You can only change logins for: ${grantable(req.user!.role)}.` });
  }
  if (role !== undefined && !canManageRole(req.user!.role, role)) {
    return res.status(403).json({ error: `You can set a login to: ${grantable(req.user!.role)}.` });
  }
  if (isSelf && ((active !== undefined && !active) || (role !== undefined && role !== "admin"))) {
    return res.status(400).json({ error: "You can't deactivate or demote your own login." });
  }
  const wouldRemoveAdmin = existing.role === "admin" && existing.active && ((active !== undefined && !active) || (role !== undefined && role !== "admin"));
  if (wouldRemoveAdmin && (await activeAdminCount(existing.id)) === 0) {
    return res.status(400).json({ error: "There must be at least one active admin." });
  }
  if (password !== undefined && !isValidPassword(password)) return res.status(400).json({ error: "Password must be at least 8 characters." });

  const nextRole = role ?? existing.role;
  let nextTechnicianId: string | null | undefined;
  if (nextRole !== "technician") {
    nextTechnicianId = null;
  } else if (technicianId !== undefined) {
    if (technicianId === null || technicianId === "") return res.status(400).json({ error: "A technician login must be linked to a technician." });
    const tech = await prisma.technician.findUnique({ where: { id: technicianId }, include: { user: true } });
    if (!tech) return res.status(404).json({ error: "technician not found" });
    if (tech.user && tech.user.id !== existing.id) return res.status(409).json({ error: `${tech.name} already has a login.` });
    nextTechnicianId = tech.id;
  } else if (existing.role !== "technician") {
    return res.status(400).json({ error: "Pick the technician this login belongs to." });
  }

  const user = await prisma.user.update({
    where: { id: existing.id },
    data: {
      ...(active !== undefined ? { active: !!active } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(nextTechnicianId !== undefined ? { technicianId: nextTechnicianId } : {}),
      ...(password !== undefined ? { passwordHash: await hashPassword(password), mustChangePassword: true } : {}),
    },
    select: USER_SELECT,
  });
  const what = [
    active !== undefined ? (active ? "reactivated" : "deactivated") : null,
    role !== undefined && role !== existing.role ? `role → ${role}` : null,
    password !== undefined ? "password reset" : null,
  ]
    .filter(Boolean)
    .join(", ");
  await logActivity(req, { action: "user.updated", entityType: "user", entityId: user.id, summary: `${user.username}: ${what || "updated"}` });
  res.json(user);
});

// Deleting a login is the irreversible option and orphans its activity trail, so
// it stays with admins. Everyone who can manage logins can deactivate instead,
// which is what you almost always want anyway.
usersRouter.delete("/:id", requires("user.delete"), async (req, res) => {
  const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "not found" });
  if (existing.id === req.user!.id) return res.status(400).json({ error: "You can't delete your own login." });
  if (!canActOnUser(req.user!.role, existing.role)) {
    return res.status(403).json({ error: `You can only delete logins for: ${grantable(req.user!.role)}.` });
  }
  if (existing.role === "admin" && existing.active && (await activeAdminCount(existing.id)) === 0) {
    return res.status(400).json({ error: "There must be at least one active admin." });
  }
  await prisma.user.delete({ where: { id: existing.id } });
  await logActivity(req, { action: "user.deleted", entityType: "user", entityId: existing.id, summary: `Deleted login ${existing.username}` });
  res.status(204).end();
});
