import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../db";
import { hashPassword, verifyPassword } from "../lib/passwords";
import { logActivity } from "../lib/activity";
import { requireAuth } from "../middleware/requireAuth";
import { capabilitiesOf } from "../lib/permissions";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

export function isValidUsername(v: unknown): v is string {
  return typeof v === "string" && v.trim().length >= 3 && v.trim().length <= 60;
}

export function isValidPassword(v: unknown): v is string {
  return typeof v === "string" && v.length >= 8 && v.length <= 200;
}

async function presentUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { technician: { select: { id: true, name: true, color: true, trade: true } } },
  });
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    // Sent so the client can hide what this person cannot do. It is a courtesy,
    // not a control: every route checks the same table for itself.
    capabilities: capabilitiesOf(user.role),
    technicianId: user.technicianId,
    technician: user.technician,
    mustChangePassword: user.mustChangePassword,
  };
}

authRouter.get("/me", async (req, res) => {
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    return res.json({ authenticated: false, needsSetup: true });
  }
  if (!req.user) {
    return res.json({ authenticated: false, needsSetup: false });
  }
  const user = await presentUser(req.user.id);
  if (!user) return res.json({ authenticated: false, needsSetup: false });
  res.json({ authenticated: true, needsSetup: false, username: user.username, user });
});

// Only allowed while no account exists yet — creates the first admin.
authRouter.post("/setup", async (req, res) => {
  const existing = await prisma.user.count();
  if (existing > 0) {
    return res.status(409).json({ error: "An account already exists." });
  }

  const { username, password } = req.body;
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: "Username must be 3-60 characters." });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({ data: { username: username.trim(), passwordHash, role: "admin", lastLoginAt: new Date() } });
  req.session.userId = user.id;
  const presented = await presentUser(user.id);
  res.status(201).json({ authenticated: true, username: user.username, user: presented });
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Username and password are required." });
  }

  const user = await prisma.user.findUnique({ where: { username: username.trim() } });
  if (!user || !user.active) {
    return res.status(401).json({ error: "Invalid username or password." });
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  req.session.regenerate(async (err) => {
    if (err) return res.status(500).json({ error: "Login failed." });
    req.session.userId = user.id;
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const presented = await presentUser(user.id);
    res.json({ authenticated: true, username: user.username, user: presented });
  });
});

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("mm.sid");
    res.status(204).end();
  });
});

authRouter.post("/password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!isValidPassword(newPassword)) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(401).json({ error: "Authentication required." });
  // A forced change (temporary password) still requires the temporary password itself.
  if (typeof currentPassword !== "string" || !(await verifyPassword(currentPassword, user.passwordHash))) {
    return res.status(400).json({ error: "Current password is incorrect." });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
  });
  await logActivity(req, { action: "user.password", entityType: "user", entityId: user.id, summary: `${user.username} changed their password` });
  res.json({ ok: true });
});
