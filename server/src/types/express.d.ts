import "express";

// The single definition lives with the capability matrix.
export type { Role } from "../lib/permissions";

export interface SessionUser {
  id: string;
  username: string;
  role: Role;
  technicianId: string | null;
  mustChangePassword: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}
