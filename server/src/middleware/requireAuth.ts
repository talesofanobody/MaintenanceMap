import { RequestHandler } from "express";
import { prisma } from "../db";
import { can, type Capability, type Role } from "../lib/permissions";

// Resolves the session's user once per request; inactive accounts are treated as
// signed out so a deactivated login stops working immediately.
export const attachUser: RequestHandler = async (req, _res, next) => {
  if (!req.session.userId) return next();
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { id: true, username: true, role: true, technicianId: true, active: true, mustChangePassword: true },
    });
    if (user && user.active) {
      req.user = { id: user.id, username: user.username, role: user.role as Role, technicianId: user.technicianId, mustChangePassword: user.mustChangePassword };
    }
  } catch (err) {
    return next(err);
  }
  next();
};

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required." });
  }
  next();
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required." });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "You don't have permission to do that." });
    next();
  };
}

/**
 * Guards a route by what it lets you do rather than by who you are.
 *
 * `requires("issue.delete")` says what the route is for; `ADMIN_ONLY` only said
 * who happened to be allowed on the day it was written. The difference matters
 * the moment there is more than one privileged role — the capability table can
 * then be read and changed in one place instead of sixty.
 */
export function requires(capability: Capability): RequestHandler {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required." });
    if (!can(req.user.role, capability)) return res.status(403).json({ error: "You don't have permission to do that." });
    next();
  };
}

export const ADMIN_ONLY = requireRole("admin");
