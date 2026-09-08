import { RequestHandler } from "express";

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Authentication required." });
  }
  next();
};
