import "express";

export type Role = "admin" | "technician" | "display";

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
