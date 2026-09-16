import { RequestHandler } from "express";
import { prisma } from "../db";
import type { Role } from "../types/express";

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

export const ADMIN_ONLY = requireRole("admin");
export const CAN_EDIT = requireRole("admin", "technician");
